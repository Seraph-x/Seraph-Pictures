<div align="center">
  <img src="logo.png" alt="Seraph's Pictures Logo" width="140">

# Seraph's Pictures

私有媒体工作区：面向 Cloudflare Pages 的图片 / 文件托管、后台管理、WebDAV 上传、多存储适配，并支持 Passkey 登录、API Token 与访客上传。

[English](README-EN.md) | **中文**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![Cloudflare Pages](https://img.shields.io/badge/Cloudflare-Pages-F38020?logo=cloudflare&logoColor=white)
![Vue 3](https://img.shields.io/badge/Vue-3-4FC08D?logo=vuedotjs&logoColor=white)
![Hono](https://img.shields.io/badge/Hono-backend-E36002?logo=hono&logoColor=white)
![Login: Passkey](https://img.shields.io/badge/Login-Passkey%2FWebAuthn-2563EB)

</div>

## 目录

- [简介](#简介)
- [功能特性](#功能特性)
- [效果图](#效果图)
- [前端结构](#前端结构)
- [快速部署](#快速部署)
- [存储配置](#存储配置)
- [访客上传](#访客上传)
- [环境变量参考](#环境变量参考)
- [API 使用指南](#api-使用指南)
- [使用限制](#使用限制)
- [验证](#验证)
- [路线图](#路线图)
- [致谢](#致谢)
- [许可证](#许可证)

## 简介

Seraph's Pictures 是一个轻量、私有、可部署到 Cloudflare Pages 的媒体托管工作区，用于图片、文件、音频、视频和文档的上传、浏览与管理。当前线上以根路径 Legacy 前端作为稳定主流程，同时保留 `/app/` 下的 Vue 版界面作为新版体验入口。

- `/`：主上传页
- `/login.html`：登录页（支持密码与 Passkey）
- `/admin.html`：管理后台
- `/gallery.html`：图片浏览
- `/webdav.html`：WebDAV 上传中心
- `/storage-settings.html`：存储后端设置（后台「存储配置」入口）
- `/app/status`：Vue 版状态页

Vue App 保留在 `/app/`，用于后续新版体验。当前 Cloudflare Pages 端以 Legacy 根页面为主流程；`/app/storage` 与 `/app/drive` 的 UI 已存在，但对应的 Cloudflare Functions API 仍需补齐后才能作为主流程使用（见[路线图](#路线图)）。

## 功能特性

> 本节只列出**已上线**的能力；尚在开发中的项目见[路线图](#路线图)。

- **多类型上传**：图片、音频、视频、文档与常见文件；大文件分片上传；支持从 URL 拉取上传，并对内网 / 私有地址做安全校验，阻止 SSRF。
- **多存储适配**：Telegram、Cloudflare R2、S3 兼容存储、Discord、Hugging Face、GitHub、WebDAV，可按需选择上传后端。
- **Passkey / WebAuthn 登录**：在密码登录之外支持无密码的 Passkey 登录与凭据管理（基于 `@simplewebauthn/server`）。
- **API Token 与公开 REST API**：在后台创建带作用域（upload / read / delete / paste）的 Token，通过 `/api/v1/*` 以 `Authorization: Bearer` 调用，适合脚本与 ShareX 等工具。
- **分享短链**：生成 `/s/<slug>` 短链，可选自定义 slug、访问密码、有效期与下载次数上限。
- **访客上传**：未登录访客可上传到**独立的 Telegram bot / 频道**，与管理员存储隔离；开关、保留天数、单 IP 每日次数、单文件大小上限（≤ 20MB）均存于 KV，可在后台随时调整。
- **管理后台**：文件列表、目录管理（Folder Manager）、网格视图与分页、详情查看、重命名、删除、收藏、跨目录移动。
- **手动内容管控**：管理员可对单个文件加入黑名单 / 白名单；命中黑名单的访问会跳转到 `block-img.html`，白名单模式下非白名单内容跳转到 `whitelist-on.html`。
- **WebDAV 上传中心**：`/webdav.html` 独立上传入口。
- **存储后端在线设置**：`/storage-settings.html`（后台「存储配置」入口）无需重新部署即可编辑 Telegram / WebDAV / S3 / Discord / GitHub / Hugging Face 凭据；密钥经 AES-GCM 加密后存入 KV，运行时优先于环境变量。Telegram 主通道与访客通道分开维护。
- **图片浏览器缓存**：图片响应附带 3 分钟 `private` 缓存，跨页切换不再重复下载；边缘（CDN）不缓存，删除 / 屏蔽 / 白名单对其他访客仍即时生效。
- **图库与多种链接格式**：`/gallery.html` 浏览，并一键复制 URL、Markdown、HTML、BBCode 链接。
- **在线预览与 Data Saver**：图片 / 媒体在线预览，提供省流量（Data Saver）选项。
- **认证**：Basic Auth 加 Cookie 会话登录。
- **品牌与主题**：Claude 风格主题、暗色模式与玻璃质感（glass opacity）界面。

## 效果图

<div align="center">

| 主上传页 | 图库（多种链接格式） |
| :---: | :---: |
| <img src="docs/screenshots/home.jpeg" width="380" alt="主上传页：存储选择、20MB 限制、上传目录"> | <img src="docs/screenshots/gallery.jpeg" width="380" alt="图库：URL / Markdown / HTML / BBCode 链接"> |
| **管理后台** | **Passkey 登录** |
| <img src="docs/screenshots/admin.jpeg" width="380" alt="管理后台：目录管理、网格视图、分页"> | <img src="docs/screenshots/login-passkey.jpeg" width="380" alt="使用 Passkey 登录"> |
| **在线预览（Data Saver）** | **访客模式** |
| <img src="docs/screenshots/file-preview.jpeg" width="380" alt="在线预览与 Data Saver"> | <img src="docs/screenshots/guest-mode.jpeg" width="380" alt="访客模式：单文件 20MB、每日上限"> |

</div>

## 前端结构

```txt
根路径 Legacy 前端
├── index.html          # 默认上传页
├── login.html          # 登录页（密码 + Passkey）
├── admin.html          # 当前主后台
├── gallery.html        # 图片浏览
├── webdav.html         # WebDAV 上传中心
├── storage-settings.html # 存储后端设置
├── preview.html        # 旧预览兼容页
├── block-img.html      # 黑名单屏蔽提示页
└── whitelist-on.html   # 白名单提示页

Vue App，可选入口
└── /app/
    ├── /app/           # Vue 上传页
    ├── /app/login      # Vue 登录页
    ├── /app/drive      # Vue Drive，Cloudflare API 尚未完整接通
    ├── /app/storage    # Vue 存储配置，Cloudflare API 尚未完整接通
    └── /app/status     # Vue 状态页
```

构建时 `frontend/scripts/copy-legacy.mjs` 会：

1. 构建 Vue App 到 `frontend/dist/app/`
2. 复制 Legacy 页面到 `frontend/dist/`
3. 再复制一份兼容副本到 `frontend/dist/legacy/`
4. 写入 `/app` 的 SPA rewrite 规则

## 快速部署

### 前置要求

- Node.js 18+ 与 npm
- 一个 Cloudflare 账户（用于 Pages、KV，可选 R2）
- 一个 Telegram bot 与频道 / 群组（若使用 Telegram 存储）

### 1. 安装依赖

```bash
npm install
npm --prefix frontend install
```

### 2. 准备 Telegram 凭据（可选，使用 Telegram 存储时）

1. 通过 [@BotFather](https://t.me/BotFather) 创建 bot，拿到 `TG_BOT_TOKEN`。
2. 把 bot 加入目标频道 / 群组并设为管理员。
3. 取得频道 / 群组的 `TG_CHAT_ID`。
4. 这两个值作为 **Secrets** 配置在 Cloudflare Pages 控制台，切勿写入代码或提交到仓库。

### 3. 构建与部署到 Cloudflare Pages

```bash
npm run pages:deploy
```

该脚本等价于先 `npm run frontend:build` 构建前端，再 `npx wrangler pages deploy frontend/dist` 部署产物。项目名从 `wrangler.jsonc` 的 `name` 字段读取，无需在命令行追加 `--project-name`。

> 本地开发可用 `npm start` 启动 `wrangler pages dev`（默认 8080 端口，内置 `admin:123` 的 Basic Auth 与本地 KV / R2），用于联调。

### 4. 通过 GitHub Actions 部署（Fork 部署指南）

仓库内置 `.github/workflows/pages-deploy.yml`，可把项目部署到你**自己的 Cloudflare 账户**。Fork 后：

1. **在 Cloudflare 准备资源**：创建一个 Pages 项目、一个 KV namespace，（可选）一个 R2 bucket。
2. **把 `wrangler.jsonc` 改成你自己的值**：
   - `name`：你的 Pages 项目名（工作流与 `pages:deploy` 都从这里读取项目名）
   - `kv_namespaces[].id`：你的 KV namespace id
   - `r2_buckets[].bucket_name`：你的 R2 bucket 名（不用 R2 可删掉该段）
   - `vars.WEBAUTHN_RP_ID` / `WEBAUTHN_ORIGIN`：你的域名（Passkey 用）
3. **添加仓库 Secrets**（Settings → Secrets and variables → Actions）：
   - `CLOUDFLARE_API_TOKEN`：含 `Account › Cloudflare Pages › Edit` 权限的 API Token
   - `CLOUDFLARE_ACCOUNT_ID`：你的 Cloudflare Account ID
4. **触发部署**：push 到 `main` 自动部署，或在 **Actions → pages-deploy → Run workflow** 手动触发。
5. **运行时密钥**（`TG_BOT_TOKEN`、`TG_GUEST_*` 等）在 **Pages 控制台 → Settings → Environment variables / Secrets** 配置，不要写进代码。

> 配置 `CLOUDFLARE_API_TOKEN` 之前，部署任务会自动跳过（绿色 skipped，不报错），所以本地迭代时 push 到 main 不会产生失败的 CI 记录。

### 5. Docker 自托管

Docker runtime 提供更完整的本地 / 自托管后端，包含 Vue `/api/storage/*`、`/api/drive/*`、`/api/share/*` 等接口。

```bash
npm run docker:init-env
docker compose up -d --build
```

访问：

```txt
http://localhost:8080/
http://localhost:8080/admin.html
http://localhost:8080/webdav.html
```

详见 [README-DOCKER.md](README-DOCKER.md)。

## 存储配置

支持以下上传后端，按需在环境变量 / 控制台中配置对应字段：

| 后端 | 关键配置 | 说明 |
| --- | --- | --- |
| Telegram | `TG_BOT_TOKEN`、`TG_CHAT_ID` | 默认后端，文件存入频道 / 群组 |
| Cloudflare R2 | `R2_BUCKET` 绑定（Pages）/ `R2_*`（Docker） | 与 Pages 同账户的对象存储 |
| S3 兼容 | `S3_ENDPOINT`、`S3_BUCKET`、`S3_ACCESS_KEY_ID`、`S3_SECRET_ACCESS_KEY`、`S3_REGION` | 任意 S3 兼容服务 |
| Discord | `DISCORD_WEBHOOK_URL` 或 `DISCORD_BOT_TOKEN` + `DISCORD_CHANNEL_ID` | 经 Webhook / Bot 投递 |
| Hugging Face | `HF_TOKEN`、`HF_REPO` | 存入 HF 仓库 |
| GitHub | `GITHUB_REPO`、`GITHUB_TOKEN`、`GITHUB_MODE`（releases / contents 等） | 存入仓库 Release 或内容 |
| WebDAV | `WEBDAV_BASE_URL`、`WEBDAV_USERNAME`、`WEBDAV_PASSWORD`（或 `WEBDAV_BEARER_TOKEN`） | 推荐配合 alist / openlist 聚合上游存储 |

> 所有密钥都应作为 Pages Secrets 或 Docker `.env` 配置，不要提交到仓库。

> 除环境变量外，管理员也可在 `/storage-settings.html`（后台「存储配置」入口）运行时编辑上述后端凭据，无需重新部署。配置存入 KV（key `storage_config`），其中密钥字段以 AES-GCM 加密（密钥取 `CONFIG_ENCRYPTION_KEY`，未设置时回退 `SESSION_SECRET`）。运行时 KV 配置优先于环境变量；R2 为 Cloudflare 绑定，仍只能在 Pages 设置。

## 访客上传

- 未登录访客的文件走**独立的 Telegram bot + 频道**（`TG_GUEST_BOT_TOKEN` / `TG_GUEST_CHAT_ID`），与管理员存储隔离；未配置时回退到主 bot。
- 访客策略（开关、保留天数（非负整数，0 = 永不过期）、单 IP 每日次数、单文件大小上限 ≤ 20MB）存于 KV，**可在后台「访客上传设置」面板随时调整**，无需改环境变量或重新部署。`GUEST_*` 环境变量仅作首次读取的初始默认。
- 访客文件的 KV 记录带 `expirationTtl`，到期后访问链接自动失效（字节仍留在免费的访客频道，需要彻底清空时直接清空 / 重建该频道）。

## 环境变量参考

Cloudflare Pages 常用绑定与变量（密钥请用控制台 Secrets 配置）：

| 变量 / 绑定 | 用途 |
| --- | --- |
| `BASIC_USER` / `BASIC_PASS` | 管理员账号密码 |
| `TG_BOT_TOKEN` / `TG_CHAT_ID` | 主 Telegram 存储凭据 |
| `img_url` | KV namespace 绑定（必需，存元数据与配置） |
| `CONFIG_ENCRYPTION_KEY` | 加密 `/storage-settings.html` 存入 KV 的存储凭据（未设置时回退用 `SESSION_SECRET`） |
| `R2_BUCKET` | R2 binding（可选） |
| `S3_*` | S3 兼容存储（可选） |
| `WEBDAV_*` | WebDAV 后端（可选） |
| `DISCORD_*` | Discord 后端（可选） |
| `HUGGINGFACE_*` / `HF_*` | Hugging Face 后端（可选） |
| `GITHUB_*` | GitHub 后端（可选） |
| `WEBAUTHN_RP_ID` / `WEBAUTHN_ORIGIN` | Passkey 规范域名（明文 vars，锁定后 Passkey 仅在该域名生效） |
| `TG_GUEST_BOT_TOKEN` / `TG_GUEST_CHAT_ID` | 访客上传专用 bot / 频道（Secret） |
| `GUEST_UPLOAD` | 访客上传初始默认（true/false；保存后以 KV 为准） |
| `GUEST_RETENTION_DAYS` | 访客文件保留天数初始默认（非负整数，0 = 永不过期） |
| `GUEST_DAILY_LIMIT` | 单 IP 每日上传次数初始默认 |
| `GUEST_MAX_FILE_SIZE` | 访客单文件大小初始默认（字节，上限 20MB） |

> Docker 自托管的完整变量（含 `DATA_DIR`、`DB_PATH`、`SETTINGS_STORE` 等）见 [README-DOCKER.md](README-DOCKER.md) 与 `.env.example`。

## API 使用指南

公开 REST API 位于 `/api/v1/*`，使用在后台创建的 API Token 鉴权。

### 1. 创建 Token

在管理后台（`/admin.html`）的 **API Token** 面板创建 Token，并按需勾选作用域：

- `upload`：上传文件 / 创建 paste
- `read`：列出与读取文件 / paste
- `delete`：删除文件 / paste
- `paste`：创建 paste

### 2. 鉴权方式

所有请求带上：

```http
Authorization: Bearer <API_TOKEN>
```

成功返回 `{ "success": true, ... }`；失败返回 `{ "success": false, "error": { "code", "message" } }`。

### 3. 上传示例（curl）

```bash
curl -X POST https://<your-domain>/api/v1/upload \
  -H "Authorization: Bearer <API_TOKEN>" \
  -F "file=@./photo.png" \
  -F "storage=telegram"        # 可选：telegram|r2|s3|discord|huggingface|webdav|github
```

返回示例：

```json
{
  "success": true,
  "file": { "id": "...", "name": "photo.png", "size": 12345, "type": "image/png", "storage": "telegram", "uploadedAt": "..." },
  "links": {
    "download": "https://<your-domain>/file/<id>",
    "share": "https://<your-domain>/s/<id-or-slug>",
    "delete": "https://<your-domain>/api/v1/file/<id>"
  }
}
```

上传可选参数（form 字段或 query）：`storage`、`password`（分享密码）、`expires_in`（秒）、`max_downloads`、`slug`（自定义短链）。

### 4. 端点速查

| 方法 | 路径 | 作用域 | 说明 |
| --- | --- | --- | --- |
| POST | `/api/v1/upload` | upload | 上传文件 |
| GET | `/api/v1/files` | read | 列出文件 |
| GET | `/api/v1/file/{id}` | read | 下载 / 获取文件 |
| GET | `/api/v1/file/{id}/info` | read | 获取文件信息 |
| DELETE | `/api/v1/file/{id}` | delete | 删除文件 |
| POST | `/api/v1/paste` | paste | 创建 paste |
| GET | `/api/v1/pastes` | read | 列出 paste |
| GET | `/api/v1/paste/{id}` | read | 获取 paste |
| DELETE | `/api/v1/paste/{id}` | delete | 删除 paste |

### 5. ShareX

新建一个 Custom Uploader：

- **Method**：`POST`，**Request URL**：`https://<your-domain>/api/v1/upload`
- **Headers**：`Authorization: Bearer <API_TOKEN>`
- **Body**：`multipart/form-data`，文件表单字段名为 `file`
- **URL 解析**：从响应 JSON 取 `links.download`（或 `links.share`）

## 使用限制

- Cloudflare Pages 当前主流程是 Legacy 根页面；`/app/storage`、`/app/drive` 的 Cloudflare Functions 后端尚未补齐（见[路线图](#路线图)）。
- 访客单文件大小上限为 20MB。
- 内容审核目前为**手动**黑 / 白名单；尚无自动检测（见[路线图](#路线图)）。

## 验证

提交或部署前推荐运行：

```bash
perl -e 'alarm shift; exec @ARGV' 60 ./node_modules/.bin/mocha \
  test/claude-theme.test.js \
  test/claude-layout.test.js \
  test/frontend-entrypoint.test.js \
  test/security-regression.test.js \
  --timeout 60000

npm --prefix frontend run build
```

## 路线图

以下能力**尚未上线**，仅作规划，不应视为已具备：

- **自动内容审核 / Safe Mode**：在现有手动黑白名单之上，增加自动识别与拦截不当内容（含 CSAM 检测）的能力。预览页的 Safe Mode 开关已存在，但自动检测尚未实现。
- **`/app/storage` 与 `/app/drive` 的 Cloudflare 后端**：这两个 Vue 界面已存在，但在 Cloudflare Pages 上还缺少完整的 `/api/storage/*`、`/api/drive/*`、`/api/share/*` Functions 实现；当前这些接口仅在 Docker runtime 中可用。
- **访客上传的非 Telegram 存储后端**：当前访客上传固定走独立 Telegram bot / 频道，计划扩展到 R2、S3 等其他后端。

## 致谢

- 上游项目 [katelya77/K-Vault](https://github.com/katelya77/K-Vault)，本项目在其结构与思路基础上做了品牌化与功能扩展。
- 更早的源头 [Telegraph-Image](https://github.com/cf-pages/Telegraph-Image)。

## 许可证

本项目基于 [MIT 许可证](LICENSE) 释出。
