# Seraph's Pictures Docker Guide

[Project README](README-EN.md) | [中文 Docker 指南](README-DOCKER.md)

The Docker runtime targets VPS, NAS, and local private deployments. It combines a static frontend, Node/Hono API, and persistent data volume. Docker and Cloudflare both provide Storage, Drive, Share, Passkey, API Token, and guest-upload features; they differ in persistence, upload modes, and adapter implementations—not API availability.

## Requirements and startup

- Docker Engine and Compose v2; development and diagnostic scripts use Node.js 22+.
- An HTTPS reverse proxy for public deployment and Passkeys.
- Replace every example password, session secret, configuration encryption key, and share-signing key before startup.

```bash
npm run docker:init-env
docker compose up -d --build
npm run docker:doctor
docker compose logs api
```

Open `http://localhost:8080/`; administration is `/admin.html`, while Vue Drive and storage settings are `/app/drive` and `/app/storage`. Authentication is enabled by default. `AUTH_DISABLED=true` is only for an explicitly isolated local environment and is not a production repair mechanism.

## Data and configuration

| Responsibility | Configuration |
| --- | --- |
| Identity and encryption | `BASIC_USER`, `BASIC_PASS`, `SESSION_SECRET`, `CONFIG_ENCRYPTION_KEY`, `FILE_SHARE_SECRET_CURRENT` |
| Public URL and Passkeys | `PUBLIC_BASE_URL`, `WEBAUTHN_RP_ID`, `WEBAUTHN_ORIGIN` |
| Persistence | `DATA_DIR`, `DB_PATH`, `SETTINGS_STORE`, `SETTINGS_REDIS_URL` |
| Guests | `TG_GUEST_BOT_TOKEN`, `TG_GUEST_CHAT_ID`, `GUEST_UPLOAD`, `GUEST_MAX_FILE_SIZE`, `GUEST_RETENTION_DAYS`, `TRUST_PROXY` |
| Uploads | `UPLOAD_MAX_SIZE`, `UPLOAD_SMALL_FILE_THRESHOLD`, `CHUNK_SIZE` |
| Backends | `TG_*`, `R2_*`, `S3_*`, `WEBDAV_*`, `DISCORD_*`, `HF_*`, `GITHUB_*` |

See [.env.example](.env.example) for the base template; add the guest-row variables to `.env` as the deployment requires. SQLite data persists in `kvault_data` by default. Dynamic storage profiles are AES-GCM encrypted and always stored in SQLite; Redis is only an optional, separate general settings store. Dynamic settings take precedence over environment variables, and blank secret fields preserve existing values. Start the Compose Redis profile with:

```bash
docker compose --profile redis up -d --build
npm run docker:doctor
```

For backup, stop writes and back up `kvault_data`; also take a consistent Redis backup when using external Redis. After restoration, run the doctor and verify login, listing, and downloads.

## Storage and uploads

Docker supports Telegram, R2, S3, Discord, Hugging Face, WebDAV, and GitHub through direct or chunked uploads. The default configured administrator ceiling is 100 MiB; Telegram is capped at 50 MiB, Discord at 25 MiB, and Hugging Face at 35 MiB. Lower backend limits still apply.

Administrators can add multiple named profiles of the same type at `/storage-settings` or `/app/storage`, then edit, test, enable, set the per-type default, or delete each profile. Docker R2 profiles use an S3-compatible endpoint, bucket, access key, and secret. Every administrator write persists the exact `storageId`. Disabling a profile blocks only new writes; historical reads, deletion, and migration keep using the file's persisted profile and never fall back to old `.env` credentials.

Guest uploads enforce boundaries that administrators cannot relax:

- Both dedicated `TG_GUEST_BOT_TOKEN` and `TG_GUEST_CHAT_ID` are required. Missing values fail instead of falling back to the main bot.
- The fixed per-IP quota is 10/day; retention is at least one day; the configurable ceiling is 20 MiB; `.env.example` uses a 5 MiB example default.
- Only AVIF/GIF/JPEG/PNG/WebP files whose signature, MIME, and extension agree are accepted. Visibility defaults to `public`.
- Metadata expiry invalidates project links but does not prove deletion of remote Telegram bytes; use a separate channel cleanup policy.

## Profile migration and recovery

Before migration, take a consistent Docker SQLite backup and build an input snapshot containing the Cloudflare v1 catalog, legacy settings, and file references. Run the dry-run first to inspect per-type defaults, deterministic legacy IDs, and reference counts, then apply through an environment-specific driver. The migration lock must be acquired before the first backend write; do not force progress while chunk or lifecycle references remain active.

```bash
node scripts/security/migrate-storage-profiles.mjs --input <SOURCE_SNAPSHOT.json>
node scripts/security/migrate-storage-profiles.mjs \
  --input <SOURCE_SNAPSHOT.json> --apply --driver <ENVIRONMENT_DRIVER.mjs> \
  --token <ONE_TIME_OWNER_TOKEN> \
  --cloudflare-backup <CLOUDFLARE_BACKUP.json> \
  --docker-backup <DOCKER_BACKUP.sqlite>
```

For an explicit `STORAGE_MIGRATION_FAILED`, verify backups and the old pointer. For `MIGRATION_ACTIVATION_AMBIGUOUS`, keep the Cloudflare freeze and Docker lock until authority/ledger evidence permits reconciliation. See the [migration rehearsal report](docs/2026-07-14_multi-storage-migration-rehearsal.md) for the full rollback matrix.

## Production reverse proxy

The proxy should terminate TLS, preserve `Host` and the forwarded protocol, and allow request bodies at least as large as the application upload limit. `PUBLIC_BASE_URL=https://<YOUR_DOMAIN>`, `WEBAUTHN_RP_ID=<YOUR_DOMAIN>`, and `WEBAUTHN_ORIGIN=https://<YOUR_DOMAIN>` must agree. For public guest uploads, set `TRUST_PROXY=true` only when the trusted proxy overwrites client-address headers; otherwise the quota service returns 503. Do not expose the API directly to the public internet around the proxy.

## Verification and troubleshooting

```bash
npm run frontend:build
npm test -- --reporter dot
npm run docker:doctor
npm run docker:smoke:ci
```

| Symptom | Action |
| --- | --- |
| API refuses startup | Replace `.env` example passwords/keys and inspect `docker compose logs api` |
| Settings cannot be saved | Configure a valid `CONFIG_ENCRYPTION_KEY`; check SQLite/Redis write and connection state |
| Passkey failure | Ensure RP is the domain, origin is the full HTTPS origin, and proxy headers are correct |
| Chunk upload does not complete | Check volume capacity/permissions for `CHUNK_DIR` and API logs; do not fabricate success |
| Guest upload rejected | Check the dedicated guest bot/chat, file authenticity, daily quota, and retention |
| Profile cannot be deleted or retyped | Inspect file, chunk-task, and lifecycle references; finish or reconcile them first |

Inspect containers and persistent volumes with:

```bash
docker compose ps
docker compose logs --tail=200 api
docker compose down
```

`docker compose down` preserves named volumes. Do not add a volume-removal option unless a backup is verified and data destruction is intentional.
