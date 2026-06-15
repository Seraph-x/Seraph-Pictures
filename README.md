<div align="center">
  <img src="logo.png" alt="Seraph's Pictures Logo" width="140">

# Seraph's Pictures

私有媒体工作区，面向 Cloudflare Pages 的图片/文件托管、后台管理、WebDAV 上传和多存储适配项目。

</div>

## 当前定位

Seraph's Pictures 以根路径 Legacy 前端作为默认界面：

- `/`：主上传页
- `/login.html`：登录页
- `/admin.html`：管理后台
- `/gallery.html`：图片浏览
- `/webdav.html`：WebDAV 上传中心
- `/app/status`：Vue 版状态页

Vue App 保留在 `/app/`，用于后续新版体验。当前 Cloudflare Pages 端以 Legacy 根页面为主流程；`/app/storage` 与 `/app/drive` 的 UI 已存在，但对应的 Cloudflare Functions API 仍需补齐后才能作为主流程使用。

## 主要能力

- 文件、图片、音频、视频和常见文档上传
- Telegram、R2、S3、Discord、Hugging Face、GitHub、WebDAV 等存储适配
- 管理后台：文件列表、目录管理、详细视图、黑白名单、删除、重命名、收藏
- WebDAV 独立上传中心
- 图片浏览页面
- API Token 管理
- Basic Auth + Cookie 会话登录
- URL 上传安全校验，阻止内网/私有地址拉取
- Claude 风格主题、暗色模式和 Seraph's Pictures 品牌界面

## 前端结构

```txt
根路径 Legacy 前端
├── index.html          # 默认上传页
├── login.html          # 登录页
├── admin.html          # 当前主后台
├── gallery.html        # 图片浏览
├── webdav.html         # WebDAV 上传中心
├── preview.html        # 旧预览兼容页
├── block-img.html      # 屏蔽提示页
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

## 页面跳转逻辑

默认入口：

```txt
/ -> index.html
```

主导航：

```txt
/              -> 上传首页
/gallery.html  -> 图片浏览
/admin.html    -> 管理后台
/webdav.html   -> WebDAV 上传
/app/storage   -> Vue 存储配置界面
```

认证跳转：

```txt
未登录访问受保护页面 -> /login.html?redirect=<原路径>
登录成功             -> redirect 指定路径
退出                 -> /login.html
```

Vue App 顶栏：

```txt
/app/         -> Upload
/app/drive    -> Drive
/app/storage  -> Storage
/app/status   -> Status
/             -> Legacy
```

## Cloudflare Pages 部署

### 1. 安装依赖

```bash
npm install
npm --prefix frontend install
```

### 2. 构建

```bash
npm --prefix frontend run build
```

### 3. 部署

```bash
npx wrangler pages deploy frontend/dist --project-name <your-pages-project>
```

`<your-pages-project>` 使用 Cloudflare Pages 控制台中的实际项目名；前端品牌统一为 Seraph's Pictures。

### 4. 必需环境变量/绑定

常用配置：

```txt
BASIC_USER
BASIC_PASS
TG_BOT_TOKEN
TG_CHAT_ID
img_url                  # KV namespace binding
R2_BUCKET                # 可选 R2 binding
S3_*                     # 可选 S3 兼容存储
WEBDAV_*                 # 可选 WebDAV
DISCORD_*                # 可选 Discord
HUGGINGFACE_*            # 可选 Hugging Face
GITHUB_*                 # 可选 GitHub
TG_GUEST_BOT_TOKEN       # 可选 访客上传专用 bot token（密钥，控制台配置，勿提交）
TG_GUEST_CHAT_ID         # 可选 访客上传专用频道 chat id（密钥，控制台配置，勿提交）
GUEST_UPLOAD             # 可选 访客上传初始默认（true/false；保存后以 KV 为准）
GUEST_RETENTION_DAYS     # 可选 访客文件保留天数初始默认（非负整数，0=永不过期）
GUEST_DAILY_LIMIT        # 可选 单 IP 每日上传次数初始默认
GUEST_MAX_FILE_SIZE      # 可选 访客单文件大小初始默认（字节，上限 20MB）
```

### 访客上传

- 未登录访客的文件走**独立的 Telegram bot + 频道**（`TG_GUEST_BOT_TOKEN` / `TG_GUEST_CHAT_ID`），与管理员存储隔离；未配置时回退到主 bot。
- 访客策略（开关、保留天数（非负整数，0=永不过期）、单 IP 每日次数、单文件大小上限 ≤ 20MB）存于 KV，**可在后台「访客上传设置」面板随时调整**，无需改环境变量或重新部署。`GUEST_*` 环境变量仅作首次读取的初始默认。
- 访客文件的 KV 记录带 `expirationTtl`，到期后访问链接自动失效（字节仍留在免费的访客频道，需要彻底清空时直接清空/重建该频道）。

### 通过 GitHub Actions 部署（Fork 部署指南）

仓库内置 `.github/workflows/pages-deploy.yml`，可把项目部署到你**自己的 Cloudflare 账户**。Fork 后：

1. **在 Cloudflare 准备资源**：创建一个 Pages 项目、一个 KV namespace，（可选）一个 R2 bucket。
2. **把 `wrangler.jsonc` 改成你自己的值**：
   - `name`：你的 Pages 项目名（工作流从这里读取项目名，无需改 workflow）
   - `kv_namespaces[].id`：你的 KV namespace id
   - `r2_buckets[].bucket_name`：你的 R2 bucket 名（不用 R2 可删掉该段）
   - `vars.WEBAUTHN_RP_ID` / `WEBAUTHN_ORIGIN`：你的域名（passkey 用）
3. **添加仓库 Secrets**（Settings → Secrets and variables → Actions）：
   - `CLOUDFLARE_API_TOKEN`：含 `Account › Cloudflare Pages › Edit` 权限的 API Token
   - `CLOUDFLARE_ACCOUNT_ID`：你的 Cloudflare Account ID
4. **触发部署**：push 到 `main` 自动部署，或在 **Actions → pages-deploy → Run workflow** 手动触发。
5. **运行时密钥**（`TG_BOT_TOKEN`、`TG_GUEST_*` 等）在 **Pages 控制台 → Settings → Environment variables / Secrets** 配置，不要写进代码。

> 配置 `CLOUDFLARE_API_TOKEN` 之前，部署任务会自动跳过（绿色 skipped，不报错），所以本地迭代时 push 到 main 不会产生失败的 CI 记录。


## Docker 运行

Docker runtime 提供更完整的本地/自托管后端，包含 Vue `/api/storage/*`、`/api/drive/*`、`/api/share/*` 等接口。

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

## 验证

推荐在提交或部署前运行：

```bash
perl -e 'alarm shift; exec @ARGV' 60 ./node_modules/.bin/mocha \
  test/claude-theme.test.js \
  test/claude-layout.test.js \
  test/frontend-entrypoint.test.js \
  test/security-regression.test.js \
  --timeout 60000

npm --prefix frontend run build
```

## 当前注意事项

- Cloudflare Pages 当前主流程是 Legacy 根页面。
- `/app/status` 可作为状态页使用。
- `/app/storage`、`/app/drive` 的界面存在，但 Cloudflare Functions 端还没有完整 `/api/storage/*`、`/api/drive/*`、`/api/share/*` 实现。
- `preview.html`、`block-img.html`、`whitelist-on.html` 作为兼容/提示页面保留。
- 旧 `admin-imgtc.html`、`admin-waterfall.html` 和 `_nuxt/` 已清理。
