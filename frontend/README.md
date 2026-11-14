# Frontend source / 前端源码

The supported interface uses HTML and Vue 2. All frontend source lives here;
`dist/` is generated and must not be edited or committed.

当前界面使用 HTML 与 Vue 2，前端源码集中在本目录。`dist/` 是自动生成的部署产物，请勿直接修改或提交。

| Source / 源码 | Responsibility / 用途 | Published path / 发布路径 |
| --- | --- | --- |
| `pages/*.html` | Page entrypoints / 页面入口 | `/*.html`; existing `/legacy/*.html` aliases |
| `scripts/*.js` | Shared theme and language / 公共主题、语言 | `/*.js` and `/legacy/*.js` |
| `scripts/pages/` | Page behavior and components / 页面逻辑与组件 | `/legacy/pages/` |
| `scripts/storage/` | Storage settings / 存储配置逻辑 | `/legacy/storage/` |
| `styles/*.css` | Shared theme and layout / 公共主题与布局 | `/*.css` and `/legacy/*.css` |
| `styles/pages/admin/`, `styles/pages/upload/` | Page styles / 页面样式 | `/legacy/pages/<page>/styles/` |
| `styles/pages/webdav/`, `styles/pages/storage-settings.css` | WebDAV and settings styles / WebDAV 与配置页样式 | `/legacy/pages/webdav/`, `/legacy/pages/storage-settings.css` |
| `assets/` (top-level files / 顶层文件) | Logo, icons, illustrations / 标识、图标、插图 | Root paths and existing `/legacy/` aliases |
| `assets/fonts/` | Fonts / 字体 | `/assets/` |
| `Dockerfile`, `nginx.conf` | Docker frontend image / 前端镜像 | Deployment configuration / 部署配置 |

Run from the repository root / 在仓库根目录运行：

```sh
npm run build
npm test
```

The build mapping lives in [`scripts/build-static.mjs`](../scripts/build-static.mjs).
It preserves existing URLs and file contents, including the `/upload` page alias.
`404.html` is published only at the root. References inside HTML/CSS are public
URLs, not paths relative to these source directories. Preview `frontend/dist`
after building; do not serve the source tree directly.

构建映射保留已有 URL 与文件内容，包括 `/upload` 页面别名；`404.html` 仅发布到根路径。
HTML/CSS 内的引用是发布 URL，并非源码目录的相对路径。预览时应先构建，再使用 `frontend/dist`。
新增独立页面或公共文件时，同步更新构建清单；页面脚本、页面样式和字体按上表中的目录映射复制。
