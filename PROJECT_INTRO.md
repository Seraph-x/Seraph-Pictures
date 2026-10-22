# Seraph's Pictures — project introduction

**English** | [中文](PROJECT_INTRO-ZH.md)

Seraph's Pictures is a private media workspace for hosting images, files, audio, video, and documents. Cloudflare Pages is currently the primary deployment target: the legacy pages served from the root path are the stable main interface, while the `/app` Vue app is kept as the new experience and the entry point for the upcoming migration.

## Current goals

- A lightweight, private file-hosting interface that deploys to Cloudflare Pages.
- Straightforward upload, browsing, admin console, and WebDAV upload flows, kept intact.
- Multiple storage backends, with WebDAV recommended as the aggregated storage entry point.
- Passkey / WebAuthn sign-in, scoped API tokens (public `/api/v1/*`), and guest uploads (a separate Telegram bot / channel).
- One consistent Seraph's Pictures brand and a Claude-style visual language.

## Current main flow

```txt
/              upload home
/login.html    sign-in page
/admin.html    admin console
/gallery.html  image gallery
/webdav.html   WebDAV upload center
/app/status    Vue status page
```

## Technical structure

- Legacy HTML: the main flow that is live today.
- Vue/Vite: builds into `/app` for the new upload, Drive, Storage, and Status pages.
- Cloudflare Functions: authentication, upload, status, admin, and file-access APIs.
- Docker runtime: the fuller self-hosted backend and the new Vue APIs.

## Removed content

The old `admin-imgtc.html`, `admin-waterfall.html`, and `_nuxt/` have been removed from the current version so that stale pages and historical build output are no longer exposed.
