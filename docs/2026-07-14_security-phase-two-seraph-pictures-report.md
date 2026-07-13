# Seraph Pictures 第二阶段安全升级报告

> 日期：2026-07-14  
> 范围：Cloudflare Pages、私有 Coordinator Durable Object、Workers KV、Docker 运行时  
> 状态：2A1 迁移工具与写屏障已实现；生产 marker 尚未提交

> [!WARNING]
> 可见性 marker 一旦提交，生产回滚下限即提升到 2A1。禁止在写屏障未冻结、在途写请求未归零或加密备份未通过回读校验时执行迁移。

## 执行摘要

2A1 已将文件访问从“缺省公开”改为显式 `public/private`，并为生产 KV 迁移加入强写屏障。Coordinator 会为每个 Pages 写请求发放 lease；冻结开始后拒绝新写入，只有 `active=0` 时迁移 CLI 才接受线上证明。迁移逐键保留并回读验证 value、metadata 和 expiration，完整验证后才提交 `schema:visibility:v1`。

当前验证结果：协调器写屏障、Pages 路由、迁移和运行时契约共 26 项定向测试通过，完整套件 266 项通过。生产只读预检识别出 7 个 legacy 文件记录、0 个显式记录，marker 尚未提交。

## 安全边界

| 边界 | 强制机制 | 失败行为 |
|---|---|---|
| 新写请求 | Coordinator `mutationEnter` lease | 冻结时返回 503，不进入业务处理器 |
| 在途请求 | Coordinator 统计有效 lease，包括会写 metadata 的 GET 后台任务 | `active` 非零时 CLI 拒绝迁移 |
| 损坏 metadata | 迁移前全量分类 | 零写入并返回 `VISIBILITY_RECORD_CORRUPT` |
| 数据保真 | 逐键比较 value、完整 metadata、expiration | 不提交 marker |
| marker | 写后重新读取并校验 barrier generation 与 KV audience | 不报告迁移完成 |
| 解冻 | 管理员接口直接读取 KV marker | marker 缺失或无效时返回 409 |
| CLI 日志 | Wrangler runner 转换稳定错误码 | 不输出命令参数或私有键名 |

## 执行生产迁移

以下命令假定 `BASIC_USER`、`BASIC_PASS` 和 `BACKUP_ENCRYPTION_KEY` 已在当前 shell 安全设置。命令不会打印这些值。

```bash
export CLOUDFLARE_ACCOUNT_ID=0df27d94938cdbf3a322c16edeffa3e0
export KV_NAMESPACE_ID=1dd5b18021224616b0cd017ec1f3f455
export PRODUCTION_ORIGIN=https://pictures.seraphzero.com
export SECURITY_BACKUP_OUTPUT=/tmp/seraph-pictures-kv-2a1-backup.json
```

先部署兼容的 Coordinator 和 Pages 候选，再冻结所有 Pages 写请求：

```bash
npx wrangler deploy --config workers/coordinator/wrangler.jsonc --env production
curl --fail-with-body --silent --show-error \
  --user "$BASIC_USER:$BASIC_PASS" \
  --request POST "$PRODUCTION_ORIGIN/api/admin/migration-freeze"
curl --fail-with-body --silent --show-error \
  "$PRODUCTION_ORIGIN/api/migration-freeze"
```

第二个响应必须表明 `frozen=true`、`active=0`，`generation` 为非空字符串，且 `audience` 等于 `KV_NAMESPACE_ID`。否则停止，不执行备份或迁移。迁移 CLI 只接受仓库锁定的生产源站 `https://pictures.seraphzero.com`，preview 或其他 HTTPS 站点不能提供冻结证明。

创建加密备份并完成只读预检：

```bash
node scripts/security/backup-kv-state.mjs \
  --environment production --wrangler-oauth \
  --output "$SECURITY_BACKUP_OUTPUT"
node scripts/security/migrate-visibility.mjs \
  --environment production --wrangler-oauth --dry-run
```

备份命令必须同时生成 `.manifest.json`，且只输出绝对路径和 SHA-256 checksum。迁移预检只输出总数和分类数量，不输出键名或 metadata。

执行迁移。CLI 会再次读取线上写屏障状态，并在 `active` 非零或未冻结时失败：

```bash
node scripts/security/migrate-visibility.mjs \
  --environment production --wrangler-oauth \
  --apply --confirm MIGRATE_VISIBILITY_V1 \
  --freeze-url "$PRODUCTION_ORIGIN"
```

仅当输出包含 `"markerCommitted":true` 时解除冻结。解除接口会再次直接读取 KV marker，无法提前解冻：

```bash
curl --fail-with-body --silent --show-error \
  --user "$BASIC_USER:$BASIC_PASS" \
  --request DELETE "$PRODUCTION_ORIGIN/api/admin/migration-freeze"
curl --fail-with-body --silent --show-error \
  "$PRODUCTION_ORIGIN/api/migration-freeze"
```

最终状态必须为 `frozen=false`、`active=0`。任一步失败时保持冻结，保留加密备份和错误码，不执行旧版本回滚或自动恢复。

## 已验证证据

```bash
npx mocha test/mutation-barrier.test.js \
  test/mutation-barrier-route.test.js \
  test/visibility-migration.test.js \
  test/coordinator-runtime-contract.test.js
```

结果：`26 passing`；完整套件结果为 `266 passing`。迁移库另外覆盖损坏记录零写入、部分完成集合幂等、写后值损坏、marker 回读失败和 Wrangler 命令错误脱敏。

## Cloudflare 成本影响

该方案复用项目已有 Workers KV 和单例 Durable Object，不新增第三方付费服务。每个 Pages 写请求增加一次进入和一次退出 Coordinator 调用；读请求不增加 lease 调用。迁移使用 KV 批量写入并保留原 expiration，不复制或重写 R2 对象。
