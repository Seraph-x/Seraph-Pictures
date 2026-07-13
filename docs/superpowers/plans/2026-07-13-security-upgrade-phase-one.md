# Phase One Security Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden chunk uploads, Docker authentication defaults and login throttling, and root Vue artifact synchronization without rewriting every storage backend.

**Architecture:** Put deterministic chunk calculations in small policy modules and keep runtime-specific persistence in the existing Docker and Cloudflare services. Add an injected SQLite-backed login limiter to the Docker container, validate production configuration at load time, and replace merge-copy behavior with exact directory synchronization.

**Tech Stack:** Node.js 22, Hono, Cloudflare Pages Functions, SQLite, Mocha, Vite

---

## File Map

**Create:**

- `server/lib/services/chunk-policy.js` — pure Docker chunk plan and per-part validation.
- `functions/utils/chunk-policy.js` — Workers-compatible equivalent validation.
- `server/lib/services/login-rate-limit-service.js` — SQLite login failure window logic.
- `frontend/scripts/sync-directory.mjs` — exact directory replacement helper.
- `test/server-chunk-policy.test.js` — Docker policy unit tests.
- `test/server-chunk-service.test.js` — real filesystem and SQLite chunk service tests.
- `test/cloudflare-chunk-policy.test.js` — Workers policy unit tests.
- `test/server-production-config.test.js` — production startup validation tests.
- `test/server-login-rate-limit.test.js` — Docker login limiter and route tests.
- `test/copy-legacy-sync.test.js` — stale artifact removal test.

**Modify:**

- `server/db/schema.sql` — add chunk bookkeeping and login failure schema.
- `server/db/index.js` — clean expired login failure records.
- `server/lib/config.js` — validate secure production configuration.
- `server/lib/container.js` — inject the login limiter.
- `server/lib/services/chunk-service.js` — secure IDs, async IO, exact merge validation.
- `server/routes/upload.js` — return policy errors and await chunk writes.
- `server/routes/auth.js` — enforce and clear login failure limits.
- `server/index.js` — explicitly log intentionally disabled authentication.
- `functions/api/chunked-upload/init.js` — validate and store the server chunk plan.
- `functions/api/chunked-upload/chunk.js` — validate part index and size before persistence.
- `functions/api/chunked-upload/complete.js` — verify every part and final byte total.
- `frontend/scripts/copy-legacy.mjs` — replace root `app/` rather than merge-copy it.
- `.env.example` — enable authentication by default.
- `README.md` and `README-DOCKER.md` — document secure Docker startup behavior.
- `app/assets/*` — remove obsolete generated hashes after the verified build.

### Task 1: Add deterministic chunk policies

- [ ] **Step 1: Write failing Docker policy tests**

Add cases to `test/server-chunk-policy.test.js` for valid plans, mismatched `totalChunks`, unsafe numbers, negative/out-of-range indexes, and incorrect regular/final chunk sizes.

- [ ] **Step 2: Write failing Cloudflare policy tests**

Add equivalent cases to `test/cloudflare-chunk-policy.test.js`, importing the ESM Workers module dynamically.

- [ ] **Step 3: Verify RED**

```bash
npx mocha test/server-chunk-policy.test.js test/cloudflare-chunk-policy.test.js
```

Expected: failure because both policy modules do not exist.

- [ ] **Step 4: Implement the minimal policies**

Both modules expose functions equivalent to:

```js
createChunkPlan({ fileSize, chunkSize, totalChunks })
validateChunkPart({ plan, chunkIndex, chunkSize })
```

Validation errors carry stable `code` and `status` properties. Keep every function below 50 lines and avoid runtime-specific IO.

- [ ] **Step 5: Verify GREEN**

Run the two policy test files and confirm all cases pass.

- [ ] **Step 6: Commit**

```bash
git add server/lib/services/chunk-policy.js functions/utils/chunk-policy.js test/server-chunk-policy.test.js test/cloudflare-chunk-policy.test.js
git commit -m "fix: validate chunk upload plans"
```

### Task 2: Harden Docker chunk persistence and completion

- [ ] **Step 1: Write failing service tests**

In `test/server-chunk-service.test.js`, use a temporary SQLite database and chunk directory to verify:

- task IDs are UUIDs;
- mismatched plans are rejected at init;
- invalid indexes and sizes are rejected before writing;
- complete rejects missing or modified parts;
- successful completion sends exactly the declared bytes to the injected upload service;
- failed final upload preserves task files for retry.

- [ ] **Step 2: Verify RED**

```bash
npx mocha test/server-chunk-service.test.js
```

- [ ] **Step 3: Extend schema and migration**

Add `chunk_size` and `received_bytes` to `chunk_uploads`. Update `ChunkUploadService.ensureSchema()` to migrate existing databases explicitly.

- [ ] **Step 4: Implement async persistence**

Use `node:fs/promises` and `crypto.randomUUID()`. Make `saveChunk()` asynchronous, inspect an existing part before calculating the received-byte delta, and update `received_bytes` only after a successful write.

- [ ] **Step 5: Implement bounded sequential merge**

Create a combined file in the task directory, read one expected part at a time, validate its actual size, append it, and verify final bytes. Read the combined file once for the current Buffer-based `UploadService` contract. Clean the task only after upload success.

- [ ] **Step 6: Map policy errors in routes**

Update `server/routes/upload.js` to await `saveChunk()`, return the error's real 400/413 status, and avoid converting client validation errors to 502.

- [ ] **Step 7: Verify GREEN**

```bash
npx mocha test/server-chunk-policy.test.js test/server-chunk-service.test.js test/upload-service-paths.test.js
```

- [ ] **Step 8: Commit**

```bash
git add server/db/schema.sql server/lib/services/chunk-service.js server/routes/upload.js test/server-chunk-service.test.js
git commit -m "fix: bound Docker chunk persistence"
```

### Task 3: Harden Cloudflare chunk endpoints

- [ ] **Step 1: Add failing endpoint regression tests**

Extend `test/security-regression.test.js` with direct handler tests proving init rejects inconsistent totals, chunk rejects out-of-range indexes and wrong byte sizes, and complete rejects an incorrect aggregate size.

- [ ] **Step 2: Verify RED**

```bash
npx mocha test/security-regression.test.js --grep "Cloudflare chunk"
```

- [ ] **Step 3: Apply the Workers policy**

Store `chunkSize` in task state during init. Validate part metadata before KV/R2 writes. During complete, validate each returned `ArrayBuffer` and accumulated total before constructing the final `Blob`.

- [ ] **Step 4: Preserve explicit error statuses**

Return policy error codes with 400 or 413 and keep storage failures as 5xx.

- [ ] **Step 5: Verify GREEN**

```bash
npx mocha test/cloudflare-chunk-policy.test.js test/security-regression.test.js
```

- [ ] **Step 6: Commit**

```bash
git add functions/api/chunked-upload/init.js functions/api/chunked-upload/chunk.js functions/api/chunked-upload/complete.js test/security-regression.test.js
git commit -m "fix: enforce Cloudflare chunk boundaries"
```

### Task 4: Secure Docker startup configuration

- [ ] **Step 1: Write failing configuration tests**

Add `test/server-production-config.test.js` covering empty credentials, the example password, valid production credentials, and explicit `AUTH_DISABLED=true`.

- [ ] **Step 2: Verify RED**

```bash
npx mocha test/server-production-config.test.js
```

- [ ] **Step 3: Implement explicit validation**

Add a focused `validateProductionConfig(config)` helper called by `loadConfig()`. Throw an error with code `INSECURE_PRODUCTION_CONFIG` and the exact invalid variable names. Do not generate or silently replace values.

- [ ] **Step 4: Change defaults and documentation**

Set `.env.example` to `AUTH_DISABLED=false`; update Docker documentation to require changing the example password. Log a clear warning in `server/index.js` only when the operator explicitly disables authentication.

- [ ] **Step 5: Verify GREEN**

```bash
npx mocha test/server-production-config.test.js test/server-auth-disabled.test.js
```

- [ ] **Step 6: Commit**

```bash
git add server/lib/config.js server/index.js .env.example README.md README-DOCKER.md test/server-production-config.test.js
git commit -m "fix: secure Docker authentication defaults"
```

### Task 5: Add Docker login throttling

- [ ] **Step 1: Write failing limiter tests**

In `test/server-login-rate-limit.test.js`, inject a deterministic clock and verify failure increments, the fifth failure blocks subsequent attempts, expiry resets the window, and success clears failures.

- [ ] **Step 2: Add a failing route test**

Create the Hono app with an isolated database, send failed login requests from one IP, and assert HTTP 429 plus `Retry-After` after the configured threshold.

- [ ] **Step 3: Verify RED**

```bash
npx mocha test/server-login-rate-limit.test.js
```

- [ ] **Step 4: Implement the injected service**

Create `LoginRateLimitService` with `check(ip)`, `recordFailure(ip)`, and `clear(ip)`. Use parameterized SQLite statements, a 15-minute named constant, and a five-attempt named constant.

- [ ] **Step 5: Integrate the route**

Inject the service from `server/lib/container.js`. In `server/routes/auth.js`, check before credential verification, record only invalid credentials, clear on success, and emit stable error code `LOGIN_RATE_LIMITED`.

- [ ] **Step 6: Verify GREEN**

```bash
npx mocha test/server-login-rate-limit.test.js test/server-auth-disabled.test.js
```

- [ ] **Step 7: Commit**

```bash
git add server/db/schema.sql server/db/index.js server/lib/container.js server/lib/services/login-rate-limit-service.js server/routes/auth.js test/server-login-rate-limit.test.js
git commit -m "fix: throttle Docker login failures"
```

### Task 6: Replace merge-copy with exact artifact synchronization

- [ ] **Step 1: Write the failing sync test**

Use temporary source and destination directories in `test/copy-legacy-sync.test.js`. Put a stale hash in the destination and verify synchronization removes it while preserving current source files.

- [ ] **Step 2: Verify RED**

```bash
npx mocha test/copy-legacy-sync.test.js
```

- [ ] **Step 3: Implement and integrate exact sync**

Create `syncDirectory(source, destination)` that validates both paths, removes only the destination, recreates it, and copies the source. Use it from `copy-legacy.mjs` for root `app/`.

- [ ] **Step 4: Verify GREEN and rebuild**

```bash
npx mocha test/copy-legacy-sync.test.js
npm run build
```

- [ ] **Step 5: Remove obsolete tracked assets and commit**

```bash
git add frontend/scripts/sync-directory.mjs frontend/scripts/copy-legacy.mjs test/copy-legacy-sync.test.js app
git commit -m "build: remove stale Vue artifacts"
```

### Task 7: Full regression and evidence

- [ ] **Step 1: Run the complete test suite with the required timeout**

```bash
timeout 60 npm test
```

- [ ] **Step 2: Run the production build**

```bash
npm run build
```

- [ ] **Step 3: Verify generated artifacts and repository state**

```bash
diff -u <(find app/assets -type f -exec basename {} \; | sort) <(find frontend/dist/app/assets -type f -exec basename {} \; | sort)
git diff --check
git status --short
```

- [ ] **Step 4: Review code metrics**

Confirm all new files stay below 300 lines, new functions below 50 lines, and no new silent fallback or mock-success paths were introduced.

- [ ] **Step 5: Commit any documentation-only verification adjustments**

Do not commit generated diagnostics or temporary databases.
