# Seraph's Pictures Docker Runtime Guide

The Docker runtime self-hosts Seraph's Pictures with a Node/Hono backend, static frontend pages, and local data storage. It is suitable for a VPS, NAS, or local development.

> For an overview and feature list, see [README-EN.md](README-EN.md).

## Docker vs Cloudflare Pages

- Cloudflare Pages: current production-oriented deployment. The root legacy pages are the stable main flow; the backend for `/app/storage` and `/app/drive` is not yet complete.
- Docker runtime: includes the newer backend APIs and **implements** the `/api/storage/*`, `/api/drive/*`, and `/api/share/*` endpoints used by Vue `/app/storage`, `/app/drive`, and the `/app` upload flows.
- Passkey login, API tokens (`/api/v1/*`), and guest uploads work the same on both; the only difference is the dynamic storage / Drive APIs above.

## Start

```bash
npm run docker:init-env
docker compose up -d --build
```

Open:

```txt
http://localhost:8080/
http://localhost:8080/admin.html
http://localhost:8080/webdav.html
```

## Common Environment Variables

```txt
BASIC_USER
BASIC_PASS
TG_BOT_TOKEN
TG_CHAT_ID
DATA_DIR
DB_PATH
SETTINGS_STORE             # sqlite | redis
CONFIG_ENCRYPTION_KEY      # encrypts dynamic storage configs (required, long random)
SESSION_SECRET             # session signing secret (long random)
WEBAUTHN_RP_ID             # Passkey canonical domain
WEBAUTHN_ORIGIN            # Passkey canonical origin (https://your-domain)
TG_GUEST_BOT_TOKEN         # dedicated guest bot (isolated from the main bot)
TG_GUEST_CHAT_ID           # dedicated guest channel chat id
GUEST_UPLOAD               # initial default for guest uploads (settings store wins after save)
GUEST_MAX_FILE_SIZE        # initial default max file size (capped at 20MB)
GUEST_DAILY_LIMIT          # initial default per-IP daily upload count
S3_*
WEBDAV_*
DISCORD_*
HUGGINGFACE_*
GITHUB_*
```

See `.env.example` for the full list.

## Passkey and Guest Uploads

- **Passkey login**: set `WEBAUTHN_RP_ID` / `WEBAUTHN_ORIGIN` to your domain to enable Passkey on the login page (password login remains available).
- **Guest uploads**: unauthenticated visitors use a separate Telegram bot / channel (`TG_GUEST_*`), isolated from admin storage; the toggle, retention days, per-IP daily limit, and max file size (≤ 20MB) live in the settings store and are editable from the admin "Guest Upload Settings" panel, with `GUEST_*` only seeding the first defaults.

## Pages

```txt
/              upload home
/login.html    login
/admin.html    admin console
/gallery.html  image gallery
/webdav.html   WebDAV upload center
/app/status    Vue status page
/app/storage   Vue storage config
/app/drive     Vue Drive console
```

## Storage Recommendation

WebDAV is the recommended aggregation entry:

1. Deploy alist/openlist on the same host or another trusted node.
2. Configure a WebDAV backend in Seraph's Pictures.
3. Let alist/openlist aggregate upstream storage providers while Seraph's Pictures handles upload UX, direct links, auth, and administration.

## Verification

```bash
node scripts/docker-storage-doctor.js
node scripts/docker-ci-smoke.js
```

## Notes

- Docker static frontend no longer copies retired `admin-imgtc.html`, `admin-waterfall.html`, or `_nuxt/`.
- The root legacy pages remain the stable operation path.
- Vue `/app` pages are available for gradual migration and validation.
