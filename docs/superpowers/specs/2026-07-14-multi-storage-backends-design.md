# Multi-Storage Backend Instances Design

**Date:** 2026-07-14  
**Status:** Approved in interactive design review  
**Scope:** Cloudflare Pages/Workers and Docker runtime parity

## 1. Goal
Allow administrators to configure multiple backend instances of the same storage
type, manage them without changing the established visual design, select an exact
instance for every administrator write operation, and continue reading files from
all configured instances.
## 2. Decisions
- Both legacy and Vue settings/upload surfaces are in scope.
- Each storage type has its own default instance.
- A default instance cannot be disabled or deleted until another enabled instance
  of the same type becomes default.
- Guest upload remains isolated on Guest Channel and cannot select administrator
  profiles.
- Existing single-instance configuration migrates automatically and idempotently.
- Upload UI retains the storage-type buttons and adds a same-type instance select.
- Browser selection is remembered per type; an invalid remembered value triggers
  a visible notice before the type default is selected.
- Queue entries retain the instance selected when they were enqueued.
- Disabling a profile blocks new writes only. Existing files remain readable,
  downloadable, movable, migratable, and deletable.
- Upload, URL upload, multipart upload, Drive/admin filtering, status, and file
  migration all gain instance awareness.
- Existing background, glass cards, typography, spacing, navigation, and general
page hierarchy remain unchanged.
## 3. Non-Goals
- Guest users cannot select or discover administrator profiles.
- This work does not introduce a new storage provider.
- This work does not add load balancing, random selection, or automatic failover.
- This work does not silently reroute a failed write to another profile.
- This work does not require a new paid service.
## 4. Unified Profile Model
```json
{
  "id": "sc_uuid",
  "name": "Primary channel",
  "type": "telegram",
  "enabled": true,
  "isDefault": true,
  "config": {},
  "metadata": {},
  "createdAt": 0,
  "updatedAt": 0
}
```
### 4.1 Invariants
For each storage type independently:
1. Zero profiles is valid.
2. If profiles exist, exactly one enabled profile is the default.
3. At most one profile has `isDefault=true`.
4. The default profile must have `enabled=true`.
5. Setting a default clears the flag only from profiles of the same type.
6. A default profile cannot be disabled or deleted.
7. A profile referenced by files cannot be deleted.
8. A referenced profile cannot change its type.
9. `enabled=false` means "no new writes" rather than "unavailable for reads."

Creating the first profile of a type requires it to be enabled and makes it the
default. The API rejects contradictory input rather than rewriting it silently.
### 4.2 Persistence
- Cloudflare stores the encrypted catalog in KV schema version 2.
- Docker stores profiles in SQLite and uses a partial unique index on `type` where
  `is_default=1`.
- Shared contracts own normalization, invariant validation, selection rules, and
  error codes.
- Cloudflare profile mutations are serialized through the existing Coordinator
  mutation/config boundary. Coordinator failure is fail-closed.
- Cloudflare maintains a profile-reference ledger in the existing Coordinator for
  deletion/type-change checks; migration seeds it from historical metadata.
- Docker uses SQLite foreign keys and transactional reference queries.

No runtime keeps a second administrator-profile source after migration.
## 5. Secret Handling
- Profile secrets remain encrypted at rest with `CONFIG_ENCRYPTION_KEY`.
- List/get responses never return plaintext secrets.
- Public profile objects expose `secretsPresent` booleans by field.
- Public `config` retains the current shape: a present secret is `********` and an
  absent secret is `""`; `secretsPresent` is an object keyed by every secret field.
- An omitted or blank secret in an update preserves the existing value.
- Creating a profile requires every provider-required secret.
- Secret preservation applies only while the type is unchanged. A permitted type
  change replaces the whole config and requires every field for the new provider.
- Draft connection tests accept transient secrets but never persist or log them.
- Error responses name the missing field but never echo its submitted value.
## 6. API Contract
Existing routes remain canonical:

```text
GET    /api/storage/list
POST   /api/storage
PUT    /api/storage/:id
DELETE /api/storage/:id
POST   /api/storage/default/:id
POST   /api/storage/:id/test
POST   /api/storage/test
```

All mutations require administrator authentication. Cloudflare and Docker return
the same envelopes, status codes, and error codes.
`GET /api/storage/list` always returns every profile to the authenticated caller.
First-party views perform their explicit type/enabled filtering locally; no list
query parameters are introduced by this work.

The legacy `/api/storage-config` endpoint stops owning administrator backend
configuration after migration. It remains responsible only for Guest Channel and
other non-profile settings still represented there.
## 7. Selection Contract
Administrator write requests carry both values:

```json
{
  "storageMode": "telegram",
  "storageId": "sc_uuid"
}
```

Resolution order is deterministic:
1. With `storageId`, load that exact profile and verify `storageMode` matches.
2. With only `storageMode`, load that type's enabled default profile.
3. With neither, load the configured preferred type's enabled default profile.
4. If no legal target exists, return an explicit error.

There is no cross-profile or cross-type fallback. Existing public API clients that
send only a type remain compatible through step 2. New first-party clients always
send both values. The preferred type is the existing `DEFAULT_STORAGE_TYPE`
runtime setting, which remains a non-profile setting with precedence: explicit
runtime value, pre-migration global-default type, then `telegram`. Migration stores
the resolved value identically for Cloudflare and Docker; profile CRUD never
changes it implicitly.
## 8. Upload and File Data Flow
The exact `storageId` travels through:

- regular multipart form upload;
- URL upload;
- multipart initialization, chunk state, completion, and cancellation;
- Drive upload;
- authenticated API v1 upload;
- file copy/migration operations.
Every Cloudflare write first acquires an idempotent Coordinator reference lease;
multipart keeps it across chunks. After backend persistence, the lease enters
`committing`, file metadata is written to KV, then one Coordinator transaction
converts it to a permanent reference. `committing` leases do not expire or release
automatically. Retry/reconciliation checks the idempotency key and metadata, then
finalizes it or releases it only after confirmed backend cleanup. Thus a failure can
temporarily over-protect a profile but cannot leave a file unprotected. Docker uses
one SQLite transaction and checks both `files` and `chunk_uploads` references.
Profile delete/type-change fails while any lease or permanent reference exists.
Before a write, the runtime loads the decrypted profile, validates type and write
state, creates an adapter from that profile, and performs the write. Successful
new file metadata persists both `storageType` and `storageConfigId`.

Reads, deletes, moves, shares, and migrations resolve the adapter using the file's
persisted profile ID even when that profile is disabled. A missing referenced
profile is a visible integrity error, not a reason to use a default profile.

Cloudflare adapters stop reading provider credentials directly from global env
after profile resolution. Docker already has the required adapter-factory shape
and is aligned to the same contract.

### 8.1 R2
- R2 `config.adapterMode` is required and is `binding` or `s3`.
- `binding` requires `bindingName`; migration uses `R2_BUCKET`. The runtime accepts
  only an actually configured R2 binding and never falls back to another binding.
- `s3` requires endpoint, bucket, access key, and secret; region defaults to `auto`.
- Binding-backed and credential-backed profiles share the same public type and
file contract.
- Adapter selection is exclusively determined by `adapterMode`; required-field and
  secret-field validation follows that mode.
- The design requires no extra paid Cloudflare product.
### 8.2 Guest Upload
Anonymous requests cannot enumerate profiles and any submitted `storageId` is
ignored. The server selects only the Guest Channel specified by guest policy.
Guest quotas, retention, and size limits remain unchanged.
## 9. Settings UI
Both `/storage-settings` and `/app/storage` preserve their established visual
systems. Each storage-type card gains:

- a same-type instance select;
- Add, Edit, Enable/Disable, Set Default, Delete, and Test actions;
- an instance name field in edit/create mode;
- status badges in each select option.

Changing the select loads that instance's masked fields. Normal view is read-only;
Add or Edit enters form mode. Default-lock and in-use errors are shown adjacent to
the action area. Guest Channel remains a visually separate section.
The implementation may extract focused JavaScript/Vue components to satisfy the
project's file and function size limits, but it must not redesign the page.
## 10. Upload UI
Existing storage-type chips remain. Beneath them, a select lists enabled profiles
of the active type and initially chooses that type's default.
Selection is stored under a versioned localStorage key by type. If a remembered
profile disappears or becomes disabled, the UI displays a notice and then selects
the current type default. This is an explicit recovery, not silent fallback.

Enqueuing a file snapshots:

```text
storageMode, storageId, storageName, targetFolderPath
```

Later selector changes affect only newly enqueued files. Queue rows, results, and
errors display `type · instance name`.
## 11. Drive, Admin, Status, and Migration UI
- Filters support All Instances or one exact profile.
- File rows display storage type and profile name.
- Upload widgets use the same type-plus-instance selector.
- Migration targets require an exact enabled destination profile.
- Status probes and cards are per profile; one failing instance does not mark all
  profiles of that type unavailable.
- Disabled profiles remain selectable for historical-file filtering and source
  operations, but never as write destinations.
## 12. Migration
Migration is explicit, backed up, idempotent, and fail-closed:
1. Back up v1 Profile Catalog, legacy config, file metadata, Coordinator state, and
   Docker SQLite; freeze profile and upload mutations.
2. Preserve IDs/config/timestamps and existing file references from Cloudflare
   `storage_profiles:v1` and Docker `storage_configs`. Create deterministic IDs only
   for legacy/env configurations that have no profile.
3. Per type, retain an enabled old global default; otherwise choose the earliest
   enabled profile deterministically. A type with profiles but no enabled profile
   fails migration for explicit operator correction.
4. Existing `storageConfigId` values never change. Type-only Cloudflare files remain
   unmodified and resolve through a generation-scoped immutable
   `legacyTypeProfileIds` map matching the pre-migration runtime selection.
5. Stage Cloudflare catalog at `storage_profiles:v2:<generation>` and its reference
   ledger, including counts for type-only files. Validate them before activation.
6. One Coordinator transaction activates the catalog generation and matching ledger
   version. Runtimes read that exact generation; visibility failure returns 503 and
   never falls back. The prior generation remains available for pointer rollback.
7. Docker can backfill type-only rows with the same mapping inside one transaction.
8. Write the migration marker after activation, verify live reads, and unfreeze.

Guest Channel fields are excluded. Re-running a completed migration verifies state
without creating duplicate profiles. Failure preserves old data and returns
`STORAGE_MIGRATION_FAILED`; no partially migrated catalog becomes active.

## 13. Error Model
```text
STORAGE_SELECTION_REQUIRED
STORAGE_PROFILE_NOT_FOUND
STORAGE_TYPE_MISMATCH
STORAGE_NOT_WRITABLE
STORAGE_DEFAULT_LOCKED
STORAGE_DEFAULT_REQUIRED
STORAGE_PROFILE_IN_USE
STORAGE_SECRET_REQUIRED
STORAGE_PROFILE_INTEGRITY_ERROR
STORAGE_MIGRATION_FAILED
```

All errors are explicit and testable. UI messages identify the affected profile
without exposing secrets. Infrastructure or Coordinator outages return 503 and do
not fall back to environment configuration.

## 14. Testing
### 14.1 Contracts and repositories
- Per-type default uniqueness and independent types.
- First-profile behavior and contradictory input rejection.
- Default lock for disable/delete.
- Referenced-profile delete/type-change rejection.
- Disabled-profile read and enabled-profile write semantics.
- Secret preservation, masking, and required-secret validation.
- Cloudflare KV and Docker SQLite contract parity.

### 14.2 Runtime flows
- Exact profile selection for regular, URL, multipart, Drive, and API v1 upload.
- Type mismatch, missing, disabled, and unavailable profile failures.
- New file metadata stores the profile ID; legacy mapping is generation-safe.
- Reads/deletes/migrations continue through disabled profiles.
- Cross-Telegram instance upload and read.
- Guest requests cannot override or discover the Guest Channel.

### 14.3 Migration
- Deterministic IDs, idempotency, marker ordering, and backup artifacts.
- v1/SQLite ID preservation, deterministic legacy IDs, idempotency, and activation.
- Reference lease ordering, idempotent retry, and reconciliation fault injection.
- Historical file backfill and reference-ledger reconciliation.
- Fault injection at every persistence stage proves no half-active state.

### 14.4 Frontend and end-to-end
- Same-type select contents and per-type defaults.
- Versioned browser memory and visible invalid-selection notice.
- Queue snapshot behavior.
- Settings CRUD, enable/default lock, delete/in-use errors, and connection tests.
- Instance filters, status cards, and migration destination selection.
- Desktop/mobile visual regression for both legacy and Vue surfaces.

## 15. Release Gates
1. Full unit/contract suite passes within the repository timeout policy.
2. Cloudflare and Docker smoke tests pass.
3. AMD64 and ARM64 Docker images build.
4. Preview migration rehearsal validates backups and expected counts.
5. Existing links and shares work before and after migration.
6. Two Telegram profiles can upload and read independently.
7. Guest policy and quotas remain unchanged.
8. Production migration validates profiles, defaults, references, and live health.
