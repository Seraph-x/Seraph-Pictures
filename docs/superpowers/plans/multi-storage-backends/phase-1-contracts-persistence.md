# Phase 1 — Contracts, Persistence, and Migration

## Task 1: Shared Profile Policy

**Files:**
- Create: `shared/storage/profile-policy.cjs`
- Modify: `shared/storage/contracts.cjs`
- Modify: `server/routes/storage/common.js`
- Create: `test/storage-profile-policy.test.js`
- Modify: `test/storage-contract.test.js`

- [ ] **Step 1: Write failing policy tests**

Cover first-profile defaulting, independent per-type defaults, default lock,
referenced type-change rejection, exact ID/type matching, no-selector preferred type,
disabled-write rejection, and R2 `binding|s3` required fields.

- [ ] **Step 2: Verify RED**

Run: `npx mocha test/storage-profile-policy.test.js test/storage-contract.test.js`  
Expected: FAIL because `profile-policy.cjs` and new error codes do not exist.

- [ ] **Step 3: Implement the minimal immutable API**

Export focused functions with option objects:

```js
validateProfileMutation({ items, current, patch, references })
applyPerTypeDefault({ items, profileId })
resolveProfileSelection({ items, storageId, storageMode, preferredType, forWrite })
validateProfileConfig({ type, config, previousType })
presentProfile(profile)
```

Keep secret field ownership in one module and have `contracts.cjs` delegate masking.
Define one error/status mapping for both runtimes, including
`STORAGE_PROFILE_NOT_FOUND`, `STORAGE_DEFAULT_LOCKED`,
`STORAGE_PROFILE_IN_USE`, and `STORAGE_NOT_WRITABLE`.

- [ ] **Step 4: Verify GREEN and metrics**

Run the targeted tests and `wc -l shared/storage/*.cjs`; expected PASS and every
file at or below 300 lines.

- [ ] **Step 5: Commit**

```bash
git add shared/storage server/routes/storage/common.js test/storage-profile-policy.test.js test/storage-contract.test.js
git commit -m "feat: define multi-profile storage policy"
```

## Task 2: Docker Transactional Repository

**Files:**
- Modify: `server/db/schema.sql`
- Replace/split: `server/lib/repos/storage-config-repo.js`
- Create: `server/lib/repos/storage-config/row-mapper.js`
- Create: `server/lib/repos/storage-config/query-repo.js`
- Create: `server/lib/repos/storage-config/mutation-repo.js`
- Create: `server/lib/repos/storage-config/reference-repo.js`
- Create: `server/lib/repos/storage-config/migration-lock-repo.js`
- Modify: `server/routes/storage/crud.js`
- Modify: `server/routes/storage/connections.js`
- Create: `test/storage-profile-docker.test.js`
- Create: `test/storage-profile-docker-routes.test.js`
- Modify: `test/bootstrap-backfill.test.js`

- [ ] **Step 1: Write failing SQLite tests**

Assert a partial per-type default index, transactional default changes, first-profile
rules, disabled reads, file/chunk reference locks, type-change replacement, ID
preservation, deterministic bootstrap, shared HTTP envelopes/error codes, and stored
plus draft connection tests for every configured type. Cover a durable write
reservation and a database-backed global migration lock that block profile mutation.

- [ ] **Step 2: Verify RED**

Run: `npx mocha test/storage-profile-docker.test.js test/storage-profile-docker-routes.test.js test/bootstrap-backfill.test.js`
Expected: FAIL on current global-default behavior.

- [ ] **Step 3: Split and implement**

Keep `StorageConfigRepository` as a dependency-injected facade. Queries return
immutable mapped rows; mutations run inside one SQLite transaction and call shared
policy before SQL. Add a partial unique index:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS ux_storage_default_per_type
ON storage_configs(type) WHERE is_default = 1;
```

Check `files` and active `chunk_uploads` before delete/type change.
Routes delegate all conflicts to the shared error mapping rather than hard-coding
legacy `STORAGE_NOT_FOUND` or `STORAGE_CONFLICT` responses.
`reference-repo.js` persists pre-backend-write reservations; ambiguous reservations
continue to count as references. `migration-lock-repo.js` stores an owner/token and
is checked in the same transaction as every Docker profile mutation.

- [ ] **Step 4: Verify GREEN**

Run targeted tests, then the full 60-second suite.

- [ ] **Step 5: Commit**

```bash
git add server/db server/lib/repos server/routes/storage test/storage-profile-docker*.test.js test/bootstrap-backfill.test.js
git commit -m "feat: enforce per-type defaults in Docker storage"
```

## Task 3: Cloudflare Generation Catalog

**Files:**
- Replace/split: `functions/services/storage-profiles/repository.js`
- Create: `functions/services/storage-profiles/catalog-store.js`
- Create: `functions/services/storage-profiles/profile-codec.js`
- Create: `functions/services/storage-profiles/catalog-policy.js`
- Modify: `functions/services/storage-profiles/routes.js`
- Modify: `functions/api/storage-config.js`
- Modify: `server/routes/storage/bootstrap.js`
- Create: `test/cloudflare-storage-catalog.test.js`
- Modify: `test/cloudflare-storage-routes.test.js`
- Modify: `test/storage-config.test.js`

- [ ] **Step 1: Write failing catalog tests**

Cover v1 reading, v2 generation staging, exact active-generation reads, masked
responses plus `secretsPresent`, per-type mutations, coordinator outage 503, and no
fallback to legacy/env configuration. Prove `/api/storage-config` retains only Guest
Channel, preferred type, and other non-profile settings and cannot mutate profiles.

- [ ] **Step 2: Verify RED**

Run both Cloudflare storage test files; expect current v1/global-default failures.

- [ ] **Step 3: Implement focused modules**

`catalog-store.js` performs KV IO only. `profile-codec.js` encrypts/decrypts and
presents secrets. `catalog-policy.js` builds immutable catalogs. Repository receives
the store and Coordinator authority through dependency injection.
Remove administrator provider credentials from `/api/storage-config`; route all
profile CRUD/test through `/api/storage/*` in both runtimes.

- [ ] **Step 4: Verify GREEN and failure visibility**

Run targeted/full tests. Confirm corrupt catalog, KV outage, and Coordinator outage
remain explicit failures.

- [ ] **Step 5: Commit**

```bash
git add functions/services/storage-profiles functions/api/storage-config.js server/routes/storage/bootstrap.js test/cloudflare-storage-*.test.js test/storage-config.test.js
git commit -m "feat: add generation-based Cloudflare profile catalog"
```

## Task 4: Idempotent Migration Planner

**Files:**
- Create: `scripts/security/storage-profile-migration/source-reader.mjs`
- Create: `scripts/security/storage-profile-migration/planner.mjs`
- Create: `scripts/security/storage-profile-migration/validator.mjs`
- Create: `scripts/security/migrate-storage-profiles.mjs`
- Create: `test/storage-profile-migration.test.js`
- Modify: `package.json`

- [ ] **Step 1: Write failing pure planner tests**

Cover v1/SQLite ID preservation, deterministic legacy IDs, per-type default choice,
disabled-only rejection, `legacyTypeProfileIds`, R2 binding migration, repeat runs,
and marker ordering.

- [ ] **Step 2: Verify RED**

Run: `npx mocha test/storage-profile-migration.test.js`; expect missing modules.

- [ ] **Step 3: Implement plan/validate before effects**

The CLI emits a JSON dry-run by default. In this task `--apply` must exit explicitly
with `MIGRATION_EXECUTOR_NOT_AVAILABLE`; only Task 5 enables effects after the
Coordinator freeze/activation protocol exists. Never simulate a successful apply.

- [ ] **Step 4: Verify GREEN and dry-run reproducibility**

Run targeted tests twice against the same fixtures and compare plans byte-for-byte.

- [ ] **Step 5: Commit**

```bash
git add scripts/security package.json test/storage-profile-migration.test.js
git commit -m "feat: add idempotent storage profile migration"
```
