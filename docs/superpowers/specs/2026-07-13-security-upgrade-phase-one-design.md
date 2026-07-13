# 第一阶段安全升级设计

## 目标

在不一次性重写全部存储适配器的前提下，修复分片上传的边界校验、磁盘滥用和不必要内存复制问题，收紧 Docker 默认认证行为，为 Docker 登录增加限速，并确保 Vue 构建产物不会持续积累。

## 范围

本阶段包含：

- Docker 和 Cloudflare 分片任务元数据校验。
- 分片索引、分片大小和最终累计大小校验。
- Docker 分片文件的异步落盘与顺序合并。
- Docker 安全启动配置校验。
- Docker 登录失败限速。
- 根目录 `app/` 构建产物清理。
- 对应的自动化回归测试。

本阶段不包含：

- 七种存储后端的完整统一领域层。
- Cloudflare R2/S3 multipart upload。
- Legacy 前端与 Vue App 的合并。
- 数据库分页和全文搜索重构。

## 分片上传规则

### 分片计划

服务端根据 `fileSize` 和服务端配置的 `chunkSize` 计算唯一合法的分片计划。客户端提交的 `totalChunks` 必须严格等于：

```text
ceil(fileSize / chunkSize)
```

以下输入必须拒绝：

- `fileSize` 不是正安全整数。
- `fileSize` 超过全局或目标存储上限。
- `chunkSize` 不是正安全整数。
- `totalChunks` 不是正安全整数。
- `totalChunks` 与服务端计算结果不一致。

### 单片校验

每个分片必须满足：

- `chunkIndex` 是整数。
- `0 <= chunkIndex < totalChunks`。
- 非最后一个分片的字节数严格等于 `chunkSize`。
- 最后一个分片的字节数严格等于剩余文件字节数。
- 相同索引允许幂等重传，但新内容仍必须通过大小校验。

任务目录和对象键只能由服务端生成的 `uploadId` 与校验后的数字索引构造。

### 完成校验

complete 操作必须重新检查：

- 每个预期分片均存在。
- 每个分片的实际字节数符合计划。
- 所有分片累计字节数严格等于声明的 `fileSize`。

任一检查失败时保留任务和分片，便于客户端修复或重传；只有上传到最终存储并写入元数据成功后才清理任务。

## Docker 分片实现

新增独立的纯函数分片规则模块，路由和服务共享该模块，不在多个入口重复计算。

`ChunkUploadService` 使用 `node:fs/promises`：

1. init 使用 `crypto.randomUUID()` 生成任务 ID。
2. saveChunk 在写入前验证任务、索引和字节数。
3. complete 按索引顺序将分片流式写入单个临时合并文件。
4. 合并过程中累计实际字节数并再次验证。
5. 当前存储适配器仍需要 Buffer，因此合并完成后只读取一次受 `uploadMaxSize` 限制的文件。
6. `finally` 不进行静默清理；仅在最终上传成功后删除任务。

该设计消除 `readFileSync`、`Buffer.concat(chunks)` 和同时保存所有分片 Buffer 的峰值，但尚未实现最终存储端到端流式上传。后者属于后续存储适配器升级。

## Cloudflare 分片实现

Cloudflare 使用同等规则的运行时适配版本：

- init 验证 `totalChunks`。
- chunk 验证索引和实际字节数后才写入 KV/R2。
- complete 读取每片时重新验证大小和累计总量。
- 任务 ID 继续使用 Web Crypto 随机字节。

本阶段保留最终 `Blob/File` 组装逻辑，但通过严格边界阻止越界写入和声明大小绕过。Cloudflare multipart upload 单独实施，避免同时改动所有存储后端。

## Docker 安全启动

`.env.example` 默认设置：

```env
AUTH_DISABLED=false
```

当 `NODE_ENV=production` 且认证启用时，配置加载必须拒绝：

- 空的 `BASIC_USER`。
- 空的 `BASIC_PASS`。
- 示例占位密码。

生产环境需要动态存储加密时，还必须拒绝示例占位加密密钥。显式配置 `AUTH_DISABLED=true` 时允许无认证启动，但日志必须清楚显示认证已关闭。

配置错误直接抛出带具体变量名的异常，不自动生成凭据，也不回退到开放模式。

## Docker 登录限速

SQLite 新增登录失败记录表，键为规范化客户端 IP，保存失败次数和窗口过期时间。

规则与 Cloudflare 保持一致：

- 15 分钟窗口。
- 最多 5 次失败。
- 达到限制返回 HTTP 429 和 `Retry-After`。
- 登录成功后清除对应 IP 的失败记录。
- 窗口到期后下一次尝试从零开始。

客户端 IP 读取顺序保留现有反向代理兼容行为，但解析逻辑集中在共享工具中。

## 构建产物清理

`frontend/scripts/copy-legacy.mjs` 在复制 `dist/app` 前删除根目录 `app/`，再完整复制当前构建产物。删除只针对项目根目录中由脚本管理的 `app/`，不得影响 `frontend/src` 或其他目录。

仓库中已跟踪但不再由当前构建引用的历史哈希文件将被删除。连续两次构建后，根目录 `app/assets` 必须与 `frontend/dist/app/assets` 完全一致。

## 错误处理

新增校验错误使用明确、稳定的错误码：

- `INVALID_FILE_SIZE`
- `INVALID_TOTAL_CHUNKS`
- `CHUNK_PLAN_MISMATCH`
- `INVALID_CHUNK_INDEX`
- `INVALID_CHUNK_SIZE`
- `INCOMPLETE_UPLOAD`
- `UPLOAD_SIZE_MISMATCH`
- `INSECURE_PRODUCTION_CONFIG`
- `LOGIN_RATE_LIMITED`

错误不得被改写为无信息量的通用 500。用户输入错误返回 400 或 413；认证限速返回 429；真正的存储故障保留 5xx。

## 测试设计

所有行为修改遵循红—绿—重构：

1. 分片计划拒绝不一致的 `totalChunks`。
2. 分片保存拒绝负数、越界和非整数索引。
3. 分片保存拒绝过大或过小数据。
4. complete 拒绝缺片和累计字节数不一致。
5. Docker 生产环境拒绝空凭据和示例凭据。
6. 显式 `AUTH_DISABLED=true` 允许启动。
7. 第五次失败后登录被限制，成功登录清零。
8. 连续构建不会保留历史哈希文件。
9. 现有测试和前端构建保持通过。

## 验收标准

- 无法通过伪造 `fileSize`、`totalChunks`、`chunkIndex` 或分片字节数突破声明大小。
- Docker complete 不再同步读取所有分片并执行 `Buffer.concat(chunks)`。
- Docker 默认示例部署启用认证。
- 生产环境不会接受占位认证凭据。
- Docker 登录存在可复现的 5 次/15 分钟限速。
- 根目录不再积累旧 Vite 哈希资源。
- 完整测试与构建成功，且不引入静默降级路径。
