# Phase 1 — Contracts, Persistence, and Migration

## Task 1: Shared Profile Policy

**Files:**
- Create: `shared/storage/profile-policy.cjs`
- Modify: `shared/storage/contracts.cjs`
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

- [ ] **Step 4: Verify GREEN and metrics**

Run the targeted tests and `wc -l shared/storage/*.cjs`; expected PASS and every
file at or below 300 lines.

- [ ] **Step 5: Commit**

```bash
git add shared/storage test/storage-profile-policy.test.js test/storage-contract.test.js
git commit -m "feat: define multi-profile storage policy"
```

## Task 2: Docker Transactional Repository

**Files:**
- Modify: `server/db/schema.sql`
- Replace/split: `server/lib/repos/storage-config-repo.js`
- Create: `server/lib/repos/storage-config/row-mapper.js`
- Create: `server/lib/repos/storage-config/query-repo.js`
- Create: `server/lib/repos/storage-config/mutation-repo.js`
- Create: `test/storage-profile-docker.test.js`
- Modify: `test/bootstrap-backfill.test.js`

- [ ] **Step 1: Write failing SQLite tests**

Assert a partial per-type default index, transactional default changes, first-profile
rules, disabled reads, file/chunk reference locks, type-change replacement, ID
preservation, and deterministic bootstrap for every configured type.

- [ ] **Step 2: Verify RED**

Run: `npx mocha test/storage-profile-docker.test.js test/bootstrap-backfill.test.js`  
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

- [ ] **Step 4: Verify GREEN**

Run targeted tests, then the full 60-second suite.

- [ ] **Step 5: Commit**

```bash
git add server/db server/lib/repos test/storage-profile-docker.test.js test/bootstrap-backfill.test.js
git commit -m "feat: enforce per-type defaults in Docker storage"
```

## Task 3: Cloudflare Generation Catalog

**Files:**
- Replace/split: `functions/services/storage-profiles/repository.js`
- Create: `functions/services/storage-profiles/catalog-store.js`
- Create: `functions/services/storage-profiles/profile-codec.js`
- Create: `functions/services/storage-profiles/catalog-policy.js`
- Modify: `functions/services/storage-profiles/routes.js`
- Create: `test/cloudflare-storage-catalog.test.js`
- Modify: `test/cloudflare-storage-routes.test.js`

- [ ] **Step 1: Write failing catalog tests**

Cover v1 reading, v2 generation staging, exact active-generation reads, masked
responses plus `secretsPresent`, per-type mutations, coordinator outage 503, and no
fallback to legacy/env configuration.

- [ ] **Step 2: Verify RED**

Run both Cloudflare storage test files; expect current v1/global-default failures.

- [ ] **Step 3: Implement focused modules**

`catalog-store.js` performs KV IO only. `profile-codec.js` encrypts/decrypts and
presents secrets. `catalog-policy.js` builds immutable catalogs. Repository receives
the store and Coordinator authority through dependency injection.

- [ ] **Step 4: Verify GREEN and failure visibility**

Run targeted/full tests. Confirm corrupt catalog, KV outage, and Coordinator outage
remain explicit failures.

- [ ] **Step 5: Commit**

```bash
git add functions/services/storage-profiles test/cloudflare-storage-*.test.js
git commit -m "feat: add generation-based Cloudflare profile catalog"
```

## Task 4: Idempotent Migration Planner

**Files:**
- Create: `scripts/security/storage-profile-migration/source-reader.mjs`
- Create: `scripts/security/storage-profile-migration/planner.mjs`
- Create: `scripts/security/storage-profile-migration/validator.mjs`
- Create: `scripts/security/storage-profile-migration/executor.mjs`
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

The CLI must emit a JSON dry-run by default. `--apply` requires backup paths,
mutation freeze, staged generation validation, atomic activation, live verification,
then marker write. Never swallow a failed stage.

- [ ] **Step 4: Verify GREEN and dry-run reproducibility**

Run targeted tests twice against the same fixtures and compare plans byte-for-byte.

- [ ] **Step 5: Commit**

```bash
git add scripts/security package.json test/storage-profile-migration.test.js
git commit -m "feat: add idempotent storage profile migration"
```

