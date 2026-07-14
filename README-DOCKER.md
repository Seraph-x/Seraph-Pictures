# Seraph's Pictures Docker 运行指南

[项目中文说明](README.md) | [English Docker guide](README-DOCKER-EN.md)

Docker runtime 面向 VPS、NAS 与本地私有化部署，由静态前端、Node/Hono API 和持久数据卷组成。它与 Cloudflare runtime 都提供 Storage、Drive、Share、Passkey、API Token 和访客上传；两者差异在持久化、上传模式和存储适配实现，不在 API 是否存在。

## 要求与启动

- Docker Engine 与 Compose v2；开发和诊断脚本使用 Node.js 22+。
- HTTPS 反向代理用于公开部署和 Passkey。
- 启动前必须替换示例密码、会话密钥、配置加密密钥和分享签名密钥。

```bash
npm run docker:init-env
docker compose up -d --build
npm run docker:doctor
docker compose logs api
```

访问 `http://localhost:8080/`；管理页为 `/admin.html`，Vue Drive 与存储设置为 `/app/drive`、`/app/storage`。Docker 默认启用认证，`AUTH_DISABLED=true` 仅用于明确的本地隔离环境，不能作为生产修复手段。

## 数据与配置

| 责任 | 配置 |
| --- | --- |
| 身份与加密 | `BASIC_USER`、`BASIC_PASS`、`SESSION_SECRET`、`CONFIG_ENCRYPTION_KEY`、`FILE_SHARE_SECRET_CURRENT` |
| 公网与 Passkey | `PUBLIC_BASE_URL`、`WEBAUTHN_RP_ID`、`WEBAUTHN_ORIGIN` |
| 持久化 | `DATA_DIR`、`DB_PATH`、`SETTINGS_STORE`、`SETTINGS_REDIS_URL` |
| 访客 | `TG_GUEST_BOT_TOKEN`、`TG_GUEST_CHAT_ID`、`GUEST_UPLOAD`、`GUEST_MAX_FILE_SIZE`、`GUEST_RETENTION_DAYS`、`TRUST_PROXY` |
| 上传 | `UPLOAD_MAX_SIZE`、`UPLOAD_SMALL_FILE_THRESHOLD`、`CHUNK_SIZE` |
| 后端 | `TG_*`、`R2_*`、`S3_*`、`WEBDAV_*`、`DISCORD_*`、`HF_*`、`GITHUB_*` |

基础模板见 [.env.example](.env.example)；访客行中的扩展变量需按部署场景加入 `.env`。默认 SQLite 数据位于 `kvault_data` 持久卷。动态 storage profiles 以 AES-GCM 加密后始终保存在 SQLite；Redis 仅可作为独立的通用设置存储。动态配置优先于环境变量，空白密钥字段保留旧值。启用 Compose Redis：

```bash
docker compose --profile redis up -d --build
npm run docker:doctor
```

备份时停止写入并备份 `kvault_data`；使用外部 Redis 时同时执行其一致性备份。恢复后运行 doctor 并验证登录、列表和下载。

## 存储与上传

Docker 支持 Telegram、R2、S3、Discord、Hugging Face、WebDAV、GitHub，上传模式为 direct 或 chunked。管理员默认配置上限为 100 MiB；Telegram 最高 50 MiB、Discord 25 MiB、Hugging Face 35 MiB。后端服务的更低上限仍然生效。

管理员可在 `/storage-settings` 或 `/app/storage` 为同一类型添加多个命名 Profile，并分别编辑、测试、启用、设为该类型默认或删除。Docker R2 Profile 使用 S3-compatible endpoint、bucket、access key 与 secret；每次管理员写入都保存精确 `storageId`。禁用 Profile 仅禁止新写入，历史读取/删除/迁移仍使用文件持久化的 Profile，不回退 `.env` 旧凭据。

访客上传遵循不可放宽的隔离边界：

- 必须同时配置独立的 `TG_GUEST_BOT_TOKEN` 与 `TG_GUEST_CHAT_ID`，缺失即失败，不回退主 Bot。
- 每 IP 每日固定 10 次；保留期至少 1 天；可配置上限 20 MiB；`.env.example` 示例默认 5 MiB。
- 仅接受签名、MIME 和扩展名一致的 AVIF/GIF/JPEG/PNG/WebP，默认可见性为 `public`。
- 元数据到期会使项目链接失效，但不代表 Telegram 远端字节已删除；远端清理按频道策略执行。

## Profile 迁移与恢复

迁移前一致性备份 Docker SQLite，并与 Cloudflare v1 catalog、Legacy 配置和文件引用一起生成输入快照。先 dry-run 检查每类型默认、确定性 Legacy ID 和引用计数，再使用环境专用 driver 执行。迁移锁必须在首次后端写入前取得；活动分片或 lifecycle 引用未清零时不得强制继续。

```bash
node scripts/security/migrate-storage-profiles.mjs --input <SOURCE_SNAPSHOT.json>
node scripts/security/migrate-storage-profiles.mjs \
  --input <SOURCE_SNAPSHOT.json> --apply --driver <ENVIRONMENT_DRIVER.mjs> \
  --token <ONE_TIME_OWNER_TOKEN> \
  --cloudflare-backup <CLOUDFLARE_BACKUP.json> \
  --docker-backup <DOCKER_BACKUP.sqlite>
```

`STORAGE_MIGRATION_FAILED` 明确失败时核对备份和旧指针；`MIGRATION_ACTIVATION_AMBIGUOUS` 必须保留 Cloudflare freeze 与 Docker lock，取得 authority/ledger 证据后再 reconciliation。详细演练和回滚矩阵见 [迁移演练报告](docs/2026-07-14_multi-storage-migration-rehearsal.md)。

## 生产反向代理

代理应终止 TLS、保留 `Host` 与转发协议，并限制请求体不低于应用允许的上传上限。`PUBLIC_BASE_URL=https://<YOUR_DOMAIN>`，`WEBAUTHN_RP_ID=<YOUR_DOMAIN>`，`WEBAUTHN_ORIGIN=https://<YOUR_DOMAIN>` 必须一致。开放访客上传时，仅在代理可信且会覆盖客户端地址头后设置 `TRUST_PROXY=true`；否则配额服务会返回 503。不要让 API 绕过代理直接暴露公网。

## 验证与排错

```bash
npm run frontend:build
npm test -- --reporter dot
npm run docker:doctor
npm run docker:smoke:ci
```

| 现象 | 处理 |
| --- | --- |
| API 拒绝启动 | 替换 `.env` 示例密码与密钥，查看 `docker compose logs api` |
| 配置无法保存 | 配置有效的 `CONFIG_ENCRYPTION_KEY`，检查 SQLite/Redis 可写与连接状态 |
| Passkey 失败 | 确保 RP 为域名、origin 为完整 HTTPS 源站且代理头正确 |
| 分片未完成 | 检查 `CHUNK_DIR` 所在卷容量、权限和 API 日志，不伪造成功响应 |
| 访客上传拒绝 | 检查独立访客 Bot/Chat、文件真实性、每日配额与保留期 |
| Profile 无法删除/改类型 | 检查文件、分片任务与 lifecycle 引用；先完成或 reconciliation |

容器与持久卷状态：

```bash
docker compose ps
docker compose logs --tail=200 api
docker compose down
```

`docker compose down` 保留命名卷；不要使用删除卷的参数，除非已经验证备份且明确要销毁数据。
