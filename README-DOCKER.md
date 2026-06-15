# Seraph's Pictures Docker 运行指南

Docker runtime 用于自托管 Seraph's Pictures。它提供 Node/Hono 后端、静态前端和本地数据目录，适合 VPS、NAS 或本地调试。

> 概览与功能特性见 [README.md](README.md)。

## Docker 版和 Cloudflare 版的区别

- Cloudflare Pages：当前线上主流程，根路径 Legacy 页面最稳定；`/app/storage`、`/app/drive` 的后端尚未补齐。
- Docker runtime：包含更完整的新版后端接口，**已实现** Vue `/app/storage`、`/app/drive` 依赖的 `/api/storage/*`、`/api/drive/*`、`/api/share/*`。
- Passkey 登录、API Token（`/api/v1/*`）、访客上传等能力两端一致；差异仅在上面这组动态存储 / Drive 接口。

## 启动

```bash
npm run docker:init-env
docker compose up -d --build
```

默认访问：

```txt
http://localhost:8080/
http://localhost:8080/admin.html
http://localhost:8080/webdav.html
```

## 常用环境变量

```txt
BASIC_USER
BASIC_PASS
TG_BOT_TOKEN
TG_CHAT_ID
DATA_DIR
DB_PATH
SETTINGS_STORE             # sqlite | redis
CONFIG_ENCRYPTION_KEY      # 加密动态存储配置（必填，长随机串）
SESSION_SECRET             # 会话签名密钥（长随机串）
WEBAUTHN_RP_ID             # Passkey 规范域名
WEBAUTHN_ORIGIN            # Passkey 规范来源（https://你的域名）
TG_GUEST_BOT_TOKEN         # 访客上传专用 bot（与主 bot 隔离）
TG_GUEST_CHAT_ID           # 访客上传专用频道 chat id
GUEST_UPLOAD               # 访客上传初始默认（保存后以设置存储为准）
GUEST_MAX_FILE_SIZE        # 访客单文件大小初始默认（上限 20MB）
GUEST_DAILY_LIMIT          # 单 IP 每日上传次数初始默认
S3_*
WEBDAV_*
DISCORD_*
HUGGINGFACE_*
GITHUB_*
```

完整变量见 `.env.example`。

## Passkey 与访客上传

- **Passkey 登录**：设置 `WEBAUTHN_RP_ID` / `WEBAUTHN_ORIGIN` 为你的域名后，登录页即可使用 Passkey（密码登录仍保留）。
- **访客上传**：未登录访客走独立的 Telegram bot / 频道（`TG_GUEST_*`），与管理员存储隔离；开关、保留天数、单 IP 每日次数、单文件大小上限（≤ 20MB）保存在设置存储中，可在后台「访客上传设置」面板随时调整，`GUEST_*` 仅作首次默认。

## 页面结构

```txt
/              上传首页
/login.html    登录页
/admin.html    管理后台
/gallery.html  图片浏览
/webdav.html   WebDAV 上传中心
/app/status    Vue 状态页
/app/storage   Vue 存储配置
/app/drive     Vue Drive 管理
```

## 存储建议

推荐把 WebDAV 作为聚合入口：

1. 在同机或独立节点部署 alist/openlist。
2. 在 Seraph's Pictures 中配置 WebDAV 后端。
3. 由 alist/openlist 聚合多个上游存储，Seraph's Pictures 负责上传体验、直链、认证和后台管理。

## 验证

```bash
node scripts/docker-storage-doctor.js
node scripts/docker-ci-smoke.js
```

## 注意事项

- Docker 静态前端不再复制旧 `admin-imgtc.html`、`admin-waterfall.html` 和 `_nuxt/`。
- 根路径 Legacy 页面仍然是最稳定的操作入口。
- Vue `/app` 页面适合逐步迁移和验证新版功能。
