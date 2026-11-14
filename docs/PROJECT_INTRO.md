# Seraph's Pictures — project introduction

**English** | [中文](PROJECT_INTRO-ZH.md)

Seraph's Pictures is a private media workspace for hosting images, files, audio, video, and documents. Cloudflare Pages is currently the primary deployment target: the Legacy pages served from the root path are the supported interface and retain their Vue 2 runtime.

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
/storage-settings.html  storage settings
```

## Technical structure

- `frontend/pages`, `frontend/scripts`, `frontend/styles`, and `frontend/assets`: Legacy HTML and Vue 2 runtime source; the supported UI, packaged into `frontend/dist` with `npm run build`.
- `frontend/Dockerfile`: the static frontend image definition for Docker deployments.
- Cloudflare Functions: authentication, upload, status, admin, and file-access APIs.
- Docker runtime: the self-hosted backend. Both runtimes retain the shared Storage, Drive, and Share APIs.

## Removed content

The Vue 3 `/app` UI has been removed; `/app` and its subpaths return HTTP 404 without redirecting. The old `admin-imgtc.html`, `admin-waterfall.html`, and `_nuxt/` have also been removed from the current version so that stale pages and historical build output are no longer exposed.
