# Phase 2 — Runtime Selection and Reference Safety

## Task 5: Coordinator Reference State Machine

**Files:**
- Create: `workers/coordinator/src/storage-references/reference-record.js`
- Create: `workers/coordinator/src/storage-references/reference-repository.js`
- Create: `workers/coordinator/src/storage-references/reference-service.js`
- Modify/split: `workers/coordinator/src/auth/auth-coordinator.js`
- Create: `workers/coordinator/src/auth/operation-router.js`
- Modify: `workers/coordinator/src/index.js`
- Create: `scripts/security/storage-profile-migration/executor.mjs`
- Modify: `scripts/security/migrate-storage-profiles.mjs`
- Modify: `server/lib/repos/storage-config/migration-lock-repo.js`
- Modify: `server/routes/storage/crud.js`
- Create: `test/storage-reference-coordinator.test.js`
- Modify: `test/coordinator-runtime-contract.test.js`
- Modify: `test/storage-profile-migration.test.js`

- [ ] **Step 1: Write failing state-machine tests**

Cover idempotent `reserve → committing → permanent`, safe pre-write expiry,
non-expiring committing state, `releasing`, `transferring`, mutation freeze, atomic
destination/source conversion, generation activation, reconciliation decisions, and
unknown-operation errors.

- [ ] **Step 2: Verify RED**

Run the two coordinator test files; expect missing storage-reference operations.

- [ ] **Step 3: Implement immutable records and injected dependencies**

Expose operations such as:

```text
storageRefReserve, storageRefCommitStart, storageRefCommitFinish,
storageRefReleaseStart, storageRefReleaseFinish,
storageRefTransferStart, storageRefTransferFinish, storageRefReconcile
```

Move routing out of the oversized auth coordinator before adding operations. A write
must call `storageRefCommitStart` before its first backend mutation. Alarm handling
may release an expired `reserved` lease only when its durable operation record proves
no backend write began; every ambiguous record goes to reconciliation and remains
protected. `committing`, `releasing`, and `transferring` never auto-expire.

- [ ] **Step 4: Implement the migration executor against Coordinator authority**

`--apply` requires backup paths, acquires a global profile-mutation freeze used by
every profile mutation/write entry, stages and validates the generation, atomically
activates matching ledger/catalog generations, live-verifies, writes the marker, and
finally releases the freeze. A failed stage remains visible and does not activate.
For Docker the executor acquires the SQLite migration lock created in Task 2 and
runs schema/data changes plus verification under exclusive database ownership. For
Cloudflare it uses Coordinator freeze/activation. Both locks are owner-tokened and
fail closed on contention; no in-memory lock is permitted.

- [ ] **Step 5: Verify GREEN and fault cases**

Inject failures at every transition; assert repeated operation IDs converge. Prove
the catalog mutation repository and migration executor honor the authority; Tasks
6–9 add the same check to each runtime write/lifecycle entrypoint.

- [ ] **Step 6: Commit**

```bash
git add workers/coordinator scripts/security server/lib/repos/storage-config/migration-lock-repo.js server/routes/storage/crud.js test/storage-reference-coordinator.test.js test/coordinator-runtime-contract.test.js test/storage-profile-migration.test.js
git commit -m "feat: coordinate storage profile references"
```

## Task 6: Cloudflare Runtime Resolver and Adapter Factory

**Files:**
- Create: `functions/services/storage-runtime/profile-resolver.js`
- Create: `functions/services/storage-runtime/adapter-factory.js`
- Create: `functions/services/storage-runtime/reference-client.js`
- Create: `functions/services/storage-runtime/operation-context.js`
- Modify: `functions/services/direct-upload-backends.js`
- Modify: `functions/services/file-delivery.js`
- Modify: `functions/services/file-delivery/*.js`
- Create: `test/cloudflare-storage-runtime.test.js`

- [ ] **Step 1: Write failing resolver/adapter tests**

Assert exact ID resolution, type match, preferred-type resolution, disabled-write
rejection, disabled historical reads, missing-profile integrity errors, binding R2,
S3-mode R2, migration-freeze rejection, and no env fallback.

- [ ] **Step 2: Verify RED**

Run: `npx mocha test/cloudflare-storage-runtime.test.js`; expect missing resolver.

- [ ] **Step 3: Implement dependency-injected runtime modules**

Adapters receive decrypted profile config rather than global env credentials. The
binding adapter validates `env[bindingName]`; the S3 adapter receives endpoint and
keys. File delivery resolves `storageConfigId` or generation-scoped legacy mapping.

- [ ] **Step 4: Verify GREEN**

Run targeted tests plus existing file delivery and R2 lifecycle tests.

- [ ] **Step 5: Commit**

```bash
git add functions/services/storage-runtime functions/services/direct-upload-backends.js functions/services/file-delivery* test/cloudflare-storage-runtime.test.js
git commit -m "feat: resolve Cloudflare storage by profile"
```

## Task 7: Direct and URL Upload Reference Protocol

**Files:**
- Modify: `functions/upload.js`
- Modify: `functions/api/upload-from-url.js`
- Modify: `functions/api/v1/upload.js`
- Modify: `functions/services/api-upload-metadata.js`
- Create: `functions/services/storage-runtime/write-operation.js`
- Modify: `server/routes/upload-direct.js`
- Modify: `server/routes/upload-remote.js`
- Modify: `server/lib/services/upload-service.js`
- Create: `test/storage-profile-upload.test.js`
- Modify: `test/api-v1.test.js`

- [ ] **Step 1: Write failing direct/URL tests**

Require both values from first-party and authenticated API v1 payloads, type-match validation, queue operation
ID idempotency, reference reservation before backend writes, metadata before
permanent conversion, migration-freeze rejection, and explicit failures at every
boundary. Assert Cloudflare `commitStart` and Docker durable reservation both precede
the first adapter write.

- [ ] **Step 2: Verify RED**

Run new tests and existing upload-service path tests; expect missing profile IDs.

- [ ] **Step 3: Implement one write orchestrator**

`write-operation.js` owns ordering and receives resolver, reference client, adapter,
metadata repository, and operation ID. Routes parse input and delegate only.
Docker creates a durable profile reservation in SQLite before adapter IO. Success
atomically inserts file metadata and removes the reservation; failure cleans the
backend object before removing it. Ambiguous cleanup keeps the reservation and an
explicit reconciliation record, so delete/type-change remains blocked. Reservation
creation checks the migration lock in the same transaction.

- [ ] **Step 4: Verify GREEN and no guest regression**

Run upload tests, API v1 tests, and guest handler tests.

- [ ] **Step 5: Commit**

```bash
git add functions server/routes server/lib/services test/storage-profile-upload.test.js test/api-v1.test.js
git commit -m "feat: bind direct uploads to storage profiles"
```

## Task 8: Multipart Profile Snapshot and Recovery

**Files:**
- Modify: `functions/api/chunked-upload/init.js`
- Modify: `functions/api/chunked-upload/complete.js`
- Modify: `functions/api/chunked-upload/cancel.js`
- Modify: `functions/services/multipart-client.js`
- Modify: `server/routes/upload-chunks.js`
- Modify: `server/lib/services/chunk-service.js`
- Create: `test/storage-profile-multipart.test.js`
- Modify: `test/cloudflare-multipart.test.js`
- Modify: `test/coordinator-multipart-runtime.test.js`

- [ ] **Step 1: Write failing multipart tests**

Assert init snapshots ID/type, active lease blocks profile mutation, cancel releases
only after confirmed chunk/object cleanup, completion uses the original ID, committing survives expiry, retries
finalize persisted metadata, and mismatch/disabled targets fail at init. For Docker,
assert the `chunk_uploads` reference is committed before the first chunk or multipart
backend write and remains when cleanup outcome is ambiguous.

- [ ] **Step 2: Verify RED**, running the three multipart test files.

- [ ] **Step 3: Implement the snapshot and lease transitions** without reading the
current default after initialization. Before the first chunk/backend mutation,
transition to non-expiring `committing`. Cancel enters `releasing`, removes every
chunk/object/metadata artifact, and finishes release only after cleanup is confirmed.
Docker init checks the migration lock while inserting `chunk_uploads`; cancel keeps
that row until cleanup confirmation. Keep route functions below 50 lines.

- [ ] **Step 4: Verify GREEN**, including injected failure after KV metadata write.

- [ ] **Step 5: Commit**

```bash
git add functions/api/chunked-upload functions/services/multipart-client.js server/routes/upload-chunks.js server/lib/services/chunk-service.js test/*multipart*.test.js
git commit -m "feat: persist multipart storage profile selection"
```

## Task 9: File Delete and Cross-Profile Migration

**Files:**
- Create: `functions/services/storage-runtime/delete-operation.js`
- Create: `functions/services/storage-runtime/transfer-operation.js`
- Refactor: `functions/api/manage/delete/[id].js`
- Create: `functions/api/drive/files/migrate.js`
- Modify: `functions/services/drive/deletion.js`
- Modify: `functions/services/drive/routes.js`
- Modify: `server/lib/services/upload-service.js`
- Modify: `server/routes/manage/files.js`
- Create: `test/storage-profile-lifecycle.test.js`
- Modify: `test/cloudflare-drive-routes.test.js`
- Modify: `test/runtime-storage-drive-contract.test.js`

- [ ] **Step 1: Write failing lifecycle tests** for releasing/transfer ordering,
operation-ID retries, source and destination protection, legacy count decrement,
metadata/source cleanup failures, and exact migration destination validation.
Exercise canonical `DELETE /api/manage/delete/:id`, API v1 reuse, batch deletion, and
`POST /api/drive/files/migrate` with `{ fileIds, destinationStorageId }`.

- [ ] **Step 2: Verify RED** with the three lifecycle/Drive test files.

- [ ] **Step 3: Implement the orchestrators and canonical routes** so every delete
entry delegates to `delete-operation.js` and resolves persisted `storageConfigId`
(or the generation legacy map), never global credentials. The migration endpoint
authenticates, validates one exact enabled destination profile, then delegates each
file through `transfer-operation.js`. A failure over-protects references; only
reconciliation after confirmed state may finish a release or transfer.
Docker first transactionally marks the source lifecycle state and reserves the
destination while checking the migration lock; external IO follows, and a final
transaction commits metadata/reference changes.

- [ ] **Step 4: Verify GREEN** and run all Cloudflare/Docker storage tests.

- [ ] **Step 5: Commit**

```bash
git add functions/api/manage/delete functions/api/drive/files/migrate.js functions/services/storage-runtime functions/services/drive server/lib/services server/routes/manage test/storage-profile-lifecycle.test.js test/*drive*.test.js
git commit -m "feat: protect profile references during file lifecycle"
```

## Task 10: Profile-Aware Drive Queries and Status Probes

**Files:**
- Modify: `functions/services/drive/repository.js`
- Modify: `functions/services/drive/records.js`
- Modify: `functions/services/drive/routes.js`
- Modify: `functions/services/status-probes.js`
- Modify: `functions/api/status.js`
- Modify: `server/lib/repos/drive-query-repo.js`
- Modify: `server/routes/drive/list.js`
- Modify: `server/lib/services/status-service.js`
- Modify: `server/routes/status.js`
- Modify: `shared/storage/contracts.cjs`
- Create: `test/storage-profile-drive-status.test.js`
- Modify: `test/server-status-storage.test.js`
- Modify: `test/cloudflare-drive-routes.test.js`

- [ ] **Step 1: Write failing query/status contract tests**

Require exact `storageId` filtering, profile ID/name/type in file results, legacy
type-only records mapped through `legacyTypeProfileIds`, one independently probed
status result per profile, disabled-profile read visibility, and explicit probe
errors without type-level aggregation.

- [ ] **Step 2: Verify RED**

Run the three affected test files; expect type-only query and status responses.

- [ ] **Step 3: Implement profile-aware repository methods**

Pass one immutable query object through each route. Cloudflare resolves legacy
records against the active generation; Docker filters the persisted profile ID.
Status probes receive a resolved adapter and return masked profile identity only.

- [ ] **Step 4: Verify GREEN and response compatibility**

Run Drive/status contract tests plus `npm run build`; assert existing type fields
remain while new profile fields are populated.

- [ ] **Step 5: Commit**

```bash
git add functions/services/drive functions/services/status-probes.js functions/api/status.js server/lib/repos/drive-query-repo.js server/routes/drive/list.js server/lib/services/status-service.js server/routes/status.js shared/storage/contracts.cjs test
git commit -m "feat: query and probe storage by profile"
```
