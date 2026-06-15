# Seraph's Pictures 项目介绍

Seraph's Pictures 是一个私有媒体工作区，面向图片、文件、音频、视频和文档托管场景。项目当前以 Cloudflare Pages 为主要部署目标，使用根路径 Legacy 页面作为稳定主界面，同时保留 `/app` Vue App 作为新版体验和后续迁移入口。

## 当前目标

- 提供轻量、私有、可部署到 Cloudflare Pages 的文件托管界面。
- 保留直观的上传、浏览、后台管理和 WebDAV 上传流程。
- 支持多存储后端，并推荐 WebDAV 作为聚合存储入口。
- 支持 Passkey / WebAuthn 登录、带作用域的 API Token（公开 `/api/v1/*`）与访客上传（独立 Telegram bot / 频道）。
- 统一 Seraph's Pictures 品牌和 Claude 风格视觉。

## 当前主流程

```txt
/              上传首页
/login.html    登录页
/admin.html    管理后台
/gallery.html  图片浏览
/webdav.html   WebDAV 上传中心
/app/status    Vue 状态页
```

## 技术结构

- Legacy HTML：当前线上主流程。
- Vue/Vite：构建到 `/app`，用于新版上传、Drive、Storage、Status 页面。
- Cloudflare Functions：提供认证、上传、状态、管理、文件访问等 API。
- Docker runtime：提供更完整的自托管后端和新版 Vue API。

## 已清理内容

旧 `admin-imgtc.html`、`admin-waterfall.html` 和 `_nuxt/` 已从当前版本移除，避免继续暴露过期页面和历史构建产物。
