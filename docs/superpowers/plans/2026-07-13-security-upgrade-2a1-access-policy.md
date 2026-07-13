# Security upgrade 2A1 access policy implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成配置 fail-closed、显式文件可见性、访客原子配额、私有分享和最小匿名状态，同时迁移现有公开图床数据。

**Architecture:** 共享 `.cjs` 纯策略模块由 Pages bundle 与 Docker 共同调用；Cloudflare 的强一致计数进入 Coordinator DO，Docker 使用 SQLite 事务。KV 只保存加密配置与文件元数据。

**Tech Stack:** Pages Functions、Durable Objects、KV、Hono、SQLite、Mocha。

---

## File map

- Create: `shared/security/access-policy.cjs`, `guest-policy.cjs`, `status-policy.cjs`, `error-codes.cjs`。
- Split: `functions/utils/storage-config.js` into `functions/utils/storage-config/{schema,crypto,repository,resolver}.js`。
- Create: `functions/services/file-access.js`, `file-delivery.js`, `share-access.js`, `status-probes.js`。
- Reduce: `functions/file/[id].js`, `functions/api/status.js` to route adapters under 300 lines。
- Modify: upload endpoints to persist `visibility`, `uploadSource`, `accessVersion`。
- Modify: `workers/coordinator/src/index.js`, runtime operation allowlist, Wrangler bindings, and SQLite DO migration。
- Create: `workers/coordinator/src/quota/quota-coordinator.js`, `share/share-coordinator.js`。
- Create: `workers/coordinator/src/config/{config-state-service,config-state-repository}.js`。
- Modify: `server/db/schema.sql`, file repository/routes, guest service, share routes, status route。
- Create: `scripts/security/backup-kv-metadata.mjs`, `migrate-visibility.mjs`。
- Create tests: `test/access-policy.test.js`, `cloudflare-auth-failure.test.js`, `guest-quota.test.js`, `status-boundary.test.js`, `visibility-migration.test.js`, `runtime-contract.test.js`。

### Task 1: Add shared access and status policies

- [ ] **Step 1: Write failing policy tests**

Cover public/anonymous, private/anonymous, private/admin, valid share, expired share, changed `accessVersion`, missing visibility after migration, and anonymous status.

```js
assert.deepStrictEqual(
  decideFileAccess({ visibility: 'private', actor: 'anonymous', share: null }),
  { allowed: false, conceal: true, code: 'FILE_ACCESS_DENIED' }
);
```

- [ ] **Step 2: Run RED**

Run: `npx mocha test/access-policy.test.js test/status-boundary.test.js`

Expected: missing shared policy modules.

- [ ] **Step 3: Implement pure immutable policies**

Export frozen constants and pure functions. Accept one options object per function; do not import KV, DB, request, or response types.

- [ ] **Step 4: Run GREEN and commit**

```bash
npx mocha test/access-policy.test.js test/status-boundary.test.js
git add shared/security test/access-policy.test.js test/status-boundary.test.js
git commit -m "feat: define shared security policies"
```

### Task 2: Make storage configuration fail closed

- [ ] **Step 1: Write failure-injection tests**

Assert missing uninitialized record may use env; initialized version plus KV error, absent record, corrupt schema, or decrypt error returns `STORAGE_CONFIG_UNAVAILABLE` and never returns env secrets.

- [ ] **Step 2: Run RED**

Run: `npx mocha test/storage-config.test.js test/cloudflare-auth-failure.test.js`

Expected: current `loadRawConfig` catches errors and returns `{}`.

- [ ] **Step 3: Split and implement repositories**

`repository.read()` returns one of `{ kind: 'absent' }`, `{ kind: 'value', value }`, or throws. Store immutable KV keys as `storage_config:v{n}`. The coordinator owns `committedVersion` plus optional `pendingVersion` and exposes `begin`, `commit`, `abort`, and `readAuthority` operations.

Write protocol: coordinator begins version N; Pages writes/encrypts `storage_config:vN`; Pages reads back and verifies schema/digest; coordinator commits N transactionally. Readers fetch only the committed version. Failure leaves the prior version authoritative and an alarm aborts stale pending versions. Wire config operations into the coordinator runtime allowlist, class export, SQLite migration, and Pages binding client. Tests must cover concurrent writes, KV propagation delay, failed read-back, commit retry, runtime routing, migration, binding failure, and coordinator/KV disagreement.

- [ ] **Step 4: Run GREEN**

Run full storage-config and failure tests. Confirm each production file is under 300 lines and each changed function under 50.

- [ ] **Step 5: Commit**

```bash
git add functions/utils/storage-config functions/utils/storage-config.js functions/api/storage-config.js workers/coordinator/src workers/coordinator/wrangler.jsonc test
git commit -m "fix: fail closed after storage configuration initialization"
```

### Task 3: Add explicit visibility to both runtimes

- [ ] **Step 1: Write failing persistence and route tests**

Assert guest/image-host/drive defaults, admin-only visibility update, `accessVersion` increment, anonymous concealment, and no metadata enumeration.

- [ ] **Step 2: Run RED**

Run: `npx mocha test/file-visibility.test.js test/runtime-contract.test.js`

Expected: metadata/schema lacks explicit visibility.

- [ ] **Step 3: Implement Cloudflare access services**

Split the 840-line file route by access decision, storage read, response range/cache, and share verification. The route adapter parses input and delegates; it must not contain storage-specific authorization branches.

- [ ] **Step 4: Implement Docker schema/repository changes**

Add `visibility`, `upload_source`, `access_version`, and optional `expires_at` columns with explicit defaults only for pre-migration rows. Update repository mappings immutably.

- [ ] **Step 5: Run GREEN and commit**

```bash
npx mocha test/file-visibility.test.js test/runtime-contract.test.js test/api-v1.test.js
git add functions/file functions/services functions/api server shared test
git commit -m "fix: enforce explicit file visibility"
```

### Task 4: Implement revocable private share links

- [ ] **Step 1: Write failing share contract tests**

Cover TTL 60 seconds to 30 days, HMAC payload binding, current/previous key rotation, revocation, password, download maximum, replay before expiry, and invalidation on `accessVersion` change.

- [ ] **Step 2: Run RED**

Run: `npx mocha test/share-contract.test.js`

Expected: Cloudflare and Docker share formats differ.

- [ ] **Step 3: Implement shared signature policy and runtime stores**

Use payload `${shareId}:${fileId}:${expiresAt}:${accessVersion}`. Cloudflare download counters go through `ShareCoordinator`; Docker uses one SQLite transaction. Public legacy slugs remain aliases only.

- [ ] **Step 4: Run GREEN and commit**

```bash
npx mocha test/share-contract.test.js test/api-v1.test.js
git add shared functions workers/coordinator/src/share server test
git commit -m "fix: unify revocable private share links"
```

### Task 5: Make guest quota exact and fail closed

- [ ] **Step 1: Write failing reservation tests**

Test default 10/day, burst 5/minute, concurrent reservation, complete, cancel, failure release, one-hour alarm release, missing binding 503, CF client IP source, Docker trusted-proxy source, fixed 20 MiB maximum, MIME/extension/declared/actual mismatch, mandatory retention metadata, and dedicated guest storage selection.

- [ ] **Step 2: Run RED**

Run: `npx mocha test/guest-quota.test.js test/server-login-rate-limit.test.js`

Expected: current KV check/increment is non-atomic and fail-open.

- [ ] **Step 3: Implement coordinator and SQLite transactions**

Persist only `HMAC-SHA-256(SESSION_SECRET, normalizedAddress)`. Reserve at initialization, consume at completion, and release terminal/abandoned reservations. The shared guest policy rejects content inconsistency before reservation and forces the guest channel; it never falls back to the administrator channel when guest credentials are missing.

- [ ] **Step 4: Run GREEN and commit**

```bash
npx mocha test/guest-quota.test.js test/auth-disabled.test.js
git add workers/coordinator/src/quota functions/utils/guest.js server/lib/utils/guest.js server/db test
git commit -m "fix: enforce atomic guest upload quotas"
```

### Task 6: Minimize anonymous status

- [ ] **Step 1: Add route-level failing tests**

Use injected probe spies. Anonymous request must return exactly `{ "status": "ok" }` and invoke zero probes; admin request may run bounded probes.

- [ ] **Step 2: Run RED**

Run: `npx mocha test/status-boundary.test.js test/server-status-storage.test.js`

Expected: anonymous route currently probes all configured providers.

- [ ] **Step 3: Split status adapters and probes**

Move all provider checks out of the 349-line route. Add per-probe timeout, bounded concurrency, normalized errors, and authenticated rate limit.

- [ ] **Step 4: Run GREEN and commit**

```bash
npx mocha test/status-boundary.test.js test/server-status-storage.test.js
git add functions/api/status.js functions/services/status-probes.js server/routes/storage.js test
git commit -m "fix: hide backend status from anonymous requests"
```

### Task 7: Backup and migrate existing metadata

- [ ] **Step 1: Write migration idempotency tests**

Fixtures include already migrated, legacy valid, corrupt, and partially processed records. A corrupt record stops migration and leaves the version marker unchanged.

- [ ] **Step 2: Run RED**

Run: `npx mocha test/visibility-migration.test.js`

- [ ] **Step 3: Implement backup/migration tools**

Backup writes encrypted local output outside source control plus a SHA-256 manifest. Migration adds `public`, source `legacy`, and `accessVersion=1`; it is resumable but commits the schema marker only after full verification.

- [ ] **Step 4: Dry-run against fixtures, then production backup**

Run dry-run first. Require explicit operator confirmation before external writes. Never print metadata values or secrets.

- [ ] **Step 5: Commit code and non-sensitive evidence**

```bash
git add scripts/security test/visibility-migration.test.js docs/2026-07-13_security-phase-two-report.md
git commit -m "build: add explicit visibility migration"
```

### Task 8: Add 2A1 end-to-end coverage

- [ ] **Step 1: Write failing Playwright scenarios**

Use the pre-2A0 baseline harness. Add public/private access, revoked/expired share, guest content rejection, exact quota, minimal anonymous status, and authenticated detailed status.

- [ ] **Step 2: Run RED against the pre-2A1 runtime**

Confirm failures are the missing security behavior, not fixture or browser errors.

- [ ] **Step 3: Run GREEN against Pages and Docker**

Require the same visible UI baseline, zero unexpected console/network errors, and no screenshot drift.

- [ ] **Step 4: Commit**

Commit E2E changes as `test: cover phase 2A1 access boundaries`.

### Task 9: Release 2A1 in migration-safe order

- [ ] **Step 1: Verify compatibility and take a fresh backup**

Run all 2A1 tests, build, 60-second full test command, dry-runs, and `git diff --check`. Produce a fresh encrypted production KV backup with the 2A0 tool and record its verified manifest outside the repository. The candidate must treat missing visibility as legacy public only while the authoritative schema marker is pre-migration; after marker commit, missing visibility fails closed.

- [ ] **Step 2: Deploy the backward-compatible coordinator first**

Deploy its SQLite migration with `npx wrangler deploy --config workers/coordinator/wrangler.jsonc --env production`. Probe auth schema compatibility and existing Pages behavior before continuing. Stop on any old-client incompatibility.

- [ ] **Step 3: Probe the exact Pages candidate**

Deploy `frontend/dist` to branch `security-2a1-candidate`, run the binding probe plus 2A1 E2E against its preview URL, and record the artifact manifest. Do not migrate metadata or change production if the preview fails.

- [ ] **Step 4: Promote without rebuilding**

Verify the preview artifact digest, deploy the same `frontend/dist` to `main`, repeat the binding/status/access probes, and stop before migration if any production probe fails.

- [ ] **Step 5: Execute and verify the visibility migration**

Run the production dry-run, review counts, then execute the resumable migration. Commit the schema marker only after every record verifies as explicit `public` with source `legacy` and `accessVersion=1`. On failure, leave the marker unchanged and expose the error; do not silently restore or continue.

- [ ] **Step 6: Establish the 2A1 rollback floor**

Run production-safe public/private/share/guest/status checks on both deployment URL and custom domain. Record backup checksum, coordinator/Pages IDs, migration counts, marker version, and the 2A1 commit in the security report. Once the visibility marker commits, forbid deployments older than this verified 2A1 release.
