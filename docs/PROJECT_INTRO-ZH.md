# Seraph's Pictures 项目介绍

**中文** | [English](PROJECT_INTRO.md)

Seraph's Pictures 是一个私有媒体工作区，面向图片、文件、音频、视频和文档托管场景。项目当前以 Cloudflare Pages 为主要部署目标，使用根路径 Legacy 页面作为支持的界面，并保留其 Vue 2 runtime。

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
/storage-settings.html  存储设置
```

## 技术结构

- `frontend/pages`、`frontend/scripts`、`frontend/styles`、`frontend/assets`：集中存放 Legacy HTML 与 Vue 2 runtime 源码，当前支持的界面，通过 `npm run build` 打包到 `frontend/dist`。
- `frontend/Dockerfile`：Docker 部署所用静态前端镜像的定义。
- Cloudflare Functions：提供认证、上传、状态、管理、文件访问等 API。
- Docker runtime：提供自托管后端。两种运行时均保留共用的 Storage、Drive 和 Share API。

## 已清理内容

Vue 3 `/app` 界面已移除；`/app` 及其子路径返回 HTTP 404，不做重定向。旧 `admin-imgtc.html`、`admin-waterfall.html` 和 `_nuxt/` 也已从当前版本移除，避免继续暴露过期页面和历史构建产物。
