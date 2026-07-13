# Security upgrade 2B storage and upload implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 使用 R2 原生 multipart 消除 Cloudflare 完成阶段整文件内存加载，并补齐 Cloudflare Storage/Drive API 与 Docker 契约。

**Architecture:** UploadCoordinator DO 串行化每个任务的状态转换并直接调用 R2 binding；Pages 只负责 HTTP 边界。Storage/Drive 使用统一 contract/policy 与运行时仓储适配器。

**Tech Stack:** R2 Workers API、Durable Objects、KV、Hono、SQLite、Mocha。

---

## File map

- Create: workers/coordinator/src/upload/{upload-coordinator,state-machine,repository,digest}.js。
- Modify: coordinator Wrangler config for R2/KV bindings and upload DO migration。
- Replace/split: functions/api/chunked-upload/{init,chunk,complete}.js and add functions/services/multipart-client.js。
- Create: shared/storage/{contracts,capabilities,pagination}.cjs。
- Create Cloudflare routes under functions/api/storage/ and functions/api/drive/ matching Vue calls。
- Create: functions/repos/{storage-config-repo,file-repo,folder-repo}.js。
- Split oversized server/routes/storage.js and server/routes/manage.js into focused route modules。
- Create tests: coordinator-multipart, cloudflare-multipart, storage-contract, drive-contract, backend-capabilities, reconciliation, and storage E2E。

### Task 1: Define the multipart state machine

- [ ] **Step 1: Write failing transition tests**

Cover successful lifecycle, abort lifecycle, identical part retry, conflicting retry, duplicate complete, complete/cancel race, publish-pending, and alarm cleanup.

- [ ] **Step 2: Run RED**

Run: npx mocha test/coordinator-multipart.test.js

Expected: upload coordinator modules are missing.

- [ ] **Step 3: Implement the pure transition reducer**

The reducer accepts one immutable state/event options object, returns a new frozen state, and throws MULTIPART_STATE_INVALID for disallowed transitions. It imports no R2, DO, KV, clock, or ID implementation.

- [ ] **Step 4: Run GREEN and commit**

Run the focused test, then commit workers/coordinator/src/upload/state-machine.js and its test as “feat: define multipart upload state machine”.

### Task 2: Implement Durable Object multipart orchestration

- [ ] **Step 1: Add failing tests with injected R2/KV/quota authority**

Assert exact part length, minimum non-final 5 MiB, SHA-256 mismatch rejection, ordered receipts, exact R2 complete arguments, fail-closed bindings, no full-object read, and idempotent operation IDs across retries.

- [ ] **Step 2: Run RED**

Run: npx mocha test/coordinator-multipart-runtime.test.js

- [ ] **Step 3: Implement the DO adapter and reconciliation protocol**

The adapter validates owner/visibility/quota/plan, hashes each part, compares the declared digest, uploads verified bytes, stores digest/ETag/size transactionally, and completes ordered receipts. Derive one deterministic final object key from the immutable upload ID and record it before calling R2. Every coordinator/KV/quota call carries uploadId plus a monotonic operation ID. Do not claim R2 create/complete is exactly-once because those APIs accept no idempotency key.

Use this order: reserve quota, create multipart, persist its returned uploadId, upload parts, complete R2, publish KV metadata, then consume quota. Persist pending state before each external side effect. Put immutable upload ID, declared root digest, and expected size in R2 custom metadata. After an ambiguous create/complete result, `HEAD` the deterministic key: matching metadata/size proves completion; absence permits retry or cleanup; mismatch is a hard conflict. Do not return the public link before metadata publication and quota consumption both commit.

If create succeeds before its uploadId is persisted, classify it as an orphan multipart rather than pretending it can be rediscovered. A retry may create another incomplete upload for the same key, but only the deterministic final key can become visible. Alarms abort known uploadIds; the one-day AbortIncompleteMultipartUpload rule removes unknown orphans. A completed object with unpublished metadata remains inaccessible and is reconciled by HEAD or deleted by alarm.

- [ ] **Step 4: Prove failure recovery**

Inject a crash or timeout before and after every R2, KV, and quota call. Assert retries never double-charge quota, never publish partial metadata, never expose two final keys, identify unknown create orphans for lifecycle cleanup, and eventually reach completed or explicitly failed cleanup state. Reservations have an explicit expiry; quota reclaims only after persisted state plus HEAD confirm no committed object.

- [ ] **Step 5: Run GREEN and dry-run Wrangler**

Run the focused test and npx wrangler deploy --dry-run --config workers/coordinator/wrangler.jsonc.

- [ ] **Step 6: Commit**

Commit coordinator runtime changes as “feat: coordinate R2 multipart uploads”.

### Task 3: Replace Pages chunk persistence

- [ ] **Step 1: Write failing endpoint tests**

Assert init returns the server plan, chunk forwards exact bytes/digest, complete delegates once, cancel aborts, no old KV chunk key is written, and R2 mode never creates a whole Blob/File.

- [ ] **Step 2: Run RED**

Run: npx mocha test/cloudflare-multipart.test.js test/cloudflare-chunk-endpoints.test.js

- [ ] **Step 3: Implement thin endpoint adapters**

Each endpoint parses HTTP input and delegates to multipart-client.js. Add an explicit DELETE cancellation route. Keep every changed function below 50 lines and every file below 300.

- [ ] **Step 4: Preserve the existing client interface**

Change request code only to send part SHA-256 and cancel abandoned tasks. Do not change rendered elements, labels, sequence, or styles.

- [ ] **Step 5: Run GREEN and commit**

Run all Cloudflare chunk tests and commit as “fix: stream Cloudflare chunks into R2 multipart”.

### Task 4: Enforce backend capability limits

- [ ] **Step 1: Write failing table-driven tests**

Cover R2 multipart, Telegram guest 20 MiB, configured Telegram admin limit, WebDAV/S3 streaming, and explicit unsupported mode/size errors.

- [ ] **Step 2: Run RED**

Run: npx mocha test/backend-capabilities.test.js

- [ ] **Step 3: Implement immutable descriptors**

Define named byte constants and frozen descriptors in shared/storage/capabilities.cjs. Initialization rejects before task creation or quota consumption. Never choose a fallback backend.

- [ ] **Step 4: Apply to both runtimes**

Inject the policy into both upload services and split any touched oversized file.

- [ ] **Step 5: Run GREEN and commit**

Run capability and server chunk tests; commit as “fix: enforce storage upload capabilities”.

### Task 5: Define Storage/Drive contracts

- [ ] **Step 1: Write failing fixtures for every frontend API call**

Cover all functions in frontend/src/api/storage.js and frontend/src/api/drive.js: envelopes, fields, cursor, auth, visibility, and unsupported operations.

- [ ] **Step 2: Run RED**

Run: npx mocha test/storage-contract.test.js test/drive-contract.test.js

Expected: Cloudflare routes are missing.

- [ ] **Step 3: Implement runtime-neutral schemas**

Normalize IDs, paths, pagination, visibility, capabilities, and errors without importing runtime records.

- [ ] **Step 4: Run GREEN and commit**

Commit shared/storage and contract tests as “feat: define shared Storage and Drive contracts”.

### Task 6: Implement Cloudflare Storage API

- [ ] **Step 1: Add failing route tests**

Cover list/create/update/delete/default/test-by-id/test-draft. Require admin auth, encrypted KV storage, preserved blank secrets, and explicit unsupported errors.

- [ ] **Step 2: Run RED**

Run: npx mocha test/cloudflare-storage-routes.test.js

- [ ] **Step 3: Implement repository and focused routes**

Reuse phase 2A1 storage crypto/repository. Do not duplicate schema. Split list, mutation, and connection-test responsibilities.

- [ ] **Step 4: Run GREEN and commit**

Run storage route/config/contract tests and commit as “feat: add Cloudflare Storage API”.

### Task 7: Implement Cloudflare Drive API

- [ ] **Step 1: Add failing route tests**

Cover tree/explorer, cursor pagination, create/move/delete folder, move/rename/delete files, visibility filtering, and recursive-delete authorization.

- [ ] **Step 2: Run RED**

Run: npx mocha test/cloudflare-drive-routes.test.js

- [ ] **Step 3: Implement repositories and routes**

Use KV metadata prefixes and explicit folder records. Paginate every list operation; never load all files to answer a request. All Drive routes require admin.

- [ ] **Step 4: Run GREEN and commit**

Run Cloudflare Drive and shared contract tests; commit as “feat: add Cloudflare Drive API”.

### Task 8: Align Docker with shared contracts

- [ ] **Step 1: Run contracts against Docker and record RED**

Run: npx mocha test/runtime-contract.test.js --grep "storage|drive"

- [ ] **Step 2: Split oversized routes**

Create focused server/routes/storage/ and server/routes/drive/ modules; registration façades stay below 50 lines.

- [ ] **Step 3: Align semantics**

Use shared serializers/policies, preserve endpoint URLs, and return stable unsupported-operation errors.

- [ ] **Step 4: Run GREEN and commit**

Run runtime/storage/drive contract tests and commit as “refactor: align Docker Storage and Drive contracts”.

### Task 9: Configure cleanup and verify production

- [ ] **Step 1: Add a lifecycle configuration assertion**

Require one-day AbortIncompleteMultipartUpload for the upload prefix without replacing unrelated bucket rules.

- [ ] **Step 2: Apply lifecycle only after operator approval**

Run `npx wrangler r2 bucket lifecycle list "$R2_BUCKET_NAME"`, preserve every existing rule, then apply the reviewed upload-prefix rule with `npx wrangler r2 bucket lifecycle add "$R2_BUCKET_NAME" abort-incomplete-uploads "$R2_UPLOAD_PREFIX" --abort-multipart-days 1`. List again and record sanitized before/after output. Stop if the installed Wrangler CLI does not expose this verified positional syntax; do not guess or replace existing rules.

- [ ] **Step 3: Deploy coordinator, probe, then Pages**

Run `npx wrangler deploy --config workers/coordinator/wrangler.jsonc --env production`, capture its deployment ID, then run the binding probe. Only after the probe passes, run `npx wrangler pages deploy frontend/dist --project-name k-vault --branch main` and capture the Pages deployment URL. Verify success, retry, conflict, cancel, publish-retry, quota-commit-retry, and alarm-reconciliation paths. Confirm no new legacy chunk KV keys.

- [ ] **Step 4: Commit evidence**

Update docs/2026-07-13_security-phase-two-report.md and commit as “docs: record 2B multipart and API evidence”.

### Task 10: Extend the progressive E2E gate

- [ ] **Step 1: Add failing real-runtime scenarios**

Extend the immutable 2A0 Playwright harness with R2 multipart success, identical retry, conflicting retry, cancel, publish retry, quota commit retry, Storage CRUD/test, Drive pagination/mutation, and Docker parity. Use real local KV/R2/DO persistence; do not stub successful coordinator responses.

- [ ] **Step 2: Run RED, implement only missing fixtures, then GREEN**

Run the focused browser suite against Pages-compatible and Docker launchers. Fixture failures must surface explicitly. Require zero visual diff against the pre-2A0 baseline for every existing page.

- [ ] **Step 3: Commit**

Commit E2E and reconciliation evidence as “test: cover multipart and storage workflows”.
