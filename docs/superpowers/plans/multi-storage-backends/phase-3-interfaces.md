# Phase 3 — Settings, Upload, Drive, and Status Interfaces

## Task 11: Shared Frontend Profile Selection

**Files:**
- Modify: `frontend/src/api/storage.js`
- Modify: `frontend/src/config/storage-definitions.js`
- Create: `frontend/src/utils/storage-profile-selection.js`
- Create: `frontend/src/composables/storage/useStorageProfiles.js`
- Create: `frontend/src/components/storage/StorageTargetPicker.vue`
- Refactor: `frontend/src/i18n/messages.js`
- Create: `frontend/src/i18n/messages/common.js`
- Create: `frontend/src/i18n/messages/storage.js`
- Create: `frontend/src/i18n/messages/upload.js`
- Create: `frontend/src/i18n/messages/drive.js`
- Create: `test/frontend-storage-profile-selection.test.js`

- [ ] **Step 1: Write failing selection tests**

Cover grouping, enabled-only upload choices, per-type default, versioned localStorage
shape, invalid remembered ID notice, exact queue snapshot, and R2 mode fields.

- [ ] **Step 2: Verify RED**

Run: `npx mocha test/frontend-storage-profile-selection.test.js`; expect missing API.

- [ ] **Step 3: Implement the pure selector first**, then the composable and picker.
The picker preserves existing chip classes and adds only the approved select/notice.
Split the 648-line message catalog into focused modules before adding strings; keep
the public i18n export unchanged and every resulting file below 300 lines.

- [ ] **Step 4: Verify GREEN and build**

Run targeted tests and `npm run build`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api frontend/src/config frontend/src/utils frontend/src/composables/storage frontend/src/components/storage frontend/src/i18n test/frontend-storage-profile-selection.test.js
git commit -m "feat: add reusable storage profile picker"
```

## Task 12: Vue Settings Page Multi-Instance Editor

**Files:**
- Refactor: `frontend/src/views/StorageView.vue`
- Create: `frontend/src/components/storage/StorageProfileList.vue`
- Create: `frontend/src/components/storage/StorageProfileEditor.vue`
- Create: `frontend/src/composables/storage/useStorageProfileEditor.js`
- Modify: `frontend/src/i18n/messages.js`
- Modify: `playwright.storage.config.js`
- Create: `e2e/storage-profile-settings.spec.js`

- [ ] **Step 1: Write failing Playwright/API assertions**

Test same-type select, Add/Edit/Test, enable/default lock, delete/in-use error, masked
secrets, and unchanged card/navigation classes.

- [ ] **Step 2: Verify RED**

Run the new spec with the storage runtime config; expect missing controls. Expand
`testMatch` to include both `storage-runtime.spec.js` and
`storage-profile-settings.spec.js` so the final storage E2E command executes it.

- [ ] **Step 3: Split the 360-line view before behavior changes**

Leave `StorageView.vue` as orchestration only. Components emit immutable action
payloads; the composable owns API state. Keep every resulting file below 300 lines.

- [ ] **Step 4: Implement approved controls and verify GREEN**

Run the new spec, build, and storage API tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/views/StorageView.vue frontend/src/components/storage frontend/src/composables/storage frontend/src/i18n playwright.storage.config.js e2e/storage-profile-settings.spec.js
git commit -m "feat: manage multiple profiles in Vue settings"
```

## Task 13: Vue Upload Queue Integration

**Files:**
- Refactor: `frontend/src/views/UploadView.vue`
- Create: `frontend/src/composables/upload/useUploadQueue.js`
- Create: `frontend/src/composables/upload/useUploadTransport.js`
- Create: `frontend/src/composables/upload/useUploadFolders.js`
- Create: `frontend/src/components/upload/UploadQueue.vue`
- Modify: `frontend/src/i18n/messages.js`
- Create: `test/frontend-profile-upload-payload.test.js`
- Modify: `e2e/storage-runtime.spec.js`

- [ ] **Step 1: Write failing pure and E2E tests**

Assert ordinary/URL/multipart payload IDs, queue snapshot after selector changes,
instance labels, invalid remembered-selection notice, and disabled option removal.

- [ ] **Step 2: Verify RED** with the new unit test and selected E2E case.

- [ ] **Step 3: Split the 802-line view by existing responsibilities** before adding
profile state. Retain current DOM classes, upload preparation, and image behavior.

- [ ] **Step 4: Pass `storageId` through every transport** and verify GREEN.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/views/UploadView.vue frontend/src/composables/upload frontend/src/components/upload frontend/src/i18n/messages.js test/frontend-profile-upload-payload.test.js e2e/storage-runtime.spec.js
git commit -m "feat: select exact profiles in Vue upload"
```

## Task 14: Vue Drive, Migration, and Per-Profile Status

**Files:**
- Refactor: `frontend/src/views/DriveView.vue`
- Refactor: `frontend/src/views/StatusView.vue`
- Create: `frontend/src/composables/drive/useDriveExplorer.js`
- Create: `frontend/src/composables/drive/useDriveMutations.js`
- Create: `frontend/src/composables/drive/useDriveUpload.js`
- Create: `frontend/src/components/drive/DriveToolbar.vue`
- Create: `frontend/src/components/drive/DriveFileList.vue`
- Create: `frontend/src/components/storage/StorageProfileStatusGrid.vue`
- Modify: `frontend/src/api/drive.js`
- Modify: `e2e/storage-runtime.spec.js`

- [ ] **Step 1: Write failing E2E assertions** for exact-profile filtering, file labels,
disabled source visibility, enabled migration destinations, exact upload payload,
and independent status cards for two Telegram profiles.

- [ ] **Step 2: Verify RED** against the current type-only controls.

- [ ] **Step 3: Split the 1,166-line Drive view** into orchestration, composables, and
components without changing visual classes. Keep each file below 300 lines.

- [ ] **Step 4: Implement instance-aware filters/mutations/status and verify GREEN.**

- [ ] **Step 5: Commit**

```bash
git add frontend/src/views frontend/src/composables/drive frontend/src/components/drive frontend/src/components/storage frontend/src/api/drive.js e2e/storage-runtime.spec.js
git commit -m "feat: manage files by storage profile"
```

## Task 15: Legacy Storage Settings Surface

**Files:**
- Refactor: `storage-settings.html`
- Create: `legacy/storage/api.js`
- Create: `legacy/storage/selection.js`
- Create: `legacy/storage/settings-controller.js`
- Create: `legacy/storage/settings-renderer.js`
- Create: `legacy/pages/storage-settings.css`
- Modify: `frontend/scripts/copy-legacy.mjs`
- Create: `test/legacy-storage-profile-ui.test.js`
- Modify: `e2e/baseline.spec.js`

- [ ] **Step 1: Write failing DOM/static tests**

Require the approved per-card select/actions, masked secrets, default protection,
test/delete errors, and copied `legacy/` assets in `frontend/dist`.

- [ ] **Step 2: Verify RED** with the new unit test and build-entrypoint tests.

- [ ] **Step 3: Extract the 402-line settings page** into a sub-300-line HTML shell,
CSS, renderer, and controller while preserving selectors/classes and visual output.

- [ ] **Step 4: Implement the settings controller and renderer** using immutable
view models. Configure `copy-legacy.mjs` with `legacyDirs = ['legacy']`; fail the
build when a declared asset is absent rather than silently omitting it.

- [ ] **Step 5: Implement controls and verify GREEN**

Run unit/build/E2E/visual tests on desktop and mobile. Any intended new control must
be masked in visual assertions; unrelated pixel changes fail the task.

- [ ] **Step 6: Commit**

```bash
git add storage-settings.html legacy/storage legacy/pages/storage-settings.css frontend/scripts/copy-legacy.mjs test/legacy-storage-profile-ui.test.js e2e/baseline.spec.js
git commit -m "feat: manage profiles in legacy settings"
```

## Task 16: Legacy Upload and Admin Surfaces

**Files:**
- Refactor: `index.html`
- Refactor: `admin.html`
- Create: `legacy/pages/upload/app.js`
- Create: `legacy/pages/upload/state.js`
- Create: `legacy/pages/upload/profile-mixin.js`
- Create: `legacy/pages/upload/upload-methods.js`
- Create: `legacy/pages/upload/multipart-methods.js`
- Create: `legacy/pages/upload/history-methods.js`
- Create: `legacy/pages/upload/url-upload-methods.js`
- Create: `legacy/pages/upload/auth-methods.js`
- Create: `legacy/pages/upload/i18n.js`
- Create: `legacy/pages/upload/components/page-header.js`
- Create: `legacy/pages/upload/components/upload-panel.js`
- Create: `legacy/pages/upload/components/url-upload-dialog.js`
- Create: `legacy/pages/upload/components/upload-queue.js`
- Create: `legacy/pages/upload/components/upload-results.js`
- Create: `legacy/pages/upload/components/history-panel.js`
- Create: `legacy/pages/upload/components/storage-target-picker.js`
- Create: `legacy/pages/upload/styles/tokens.css`
- Create: `legacy/pages/upload/styles/layout.css`
- Create: `legacy/pages/upload/styles/uploader.css`
- Create: `legacy/pages/upload/styles/dialogs.css`
- Create: `legacy/pages/upload/styles/responsive.css`
- Create: `legacy/pages/admin/app.js`
- Create: `legacy/pages/admin/state.js`
- Create: `legacy/pages/admin/api.js`
- Create: `legacy/pages/admin/auth-methods.js`
- Create: `legacy/pages/admin/profile-mixin.js`
- Create: `legacy/pages/admin/drive-methods.js`
- Create: `legacy/pages/admin/folder-methods.js`
- Create: `legacy/pages/admin/dashboard-methods.js`
- Create: `legacy/pages/admin/migration-methods.js`
- Create: `legacy/pages/admin/settings-methods.js`
- Create: `legacy/pages/admin/components/page-shell.js`
- Create: `legacy/pages/admin/components/dashboard-panel.js`
- Create: `legacy/pages/admin/components/file-browser.js`
- Create: `legacy/pages/admin/components/file-toolbar.js`
- Create: `legacy/pages/admin/components/file-dialogs.js`
- Create: `legacy/pages/admin/components/migration-dialog.js`
- Create: `legacy/pages/admin/components/status-panel.js`
- Create: `legacy/pages/admin/components/profile-filter.js`
- Create: `legacy/pages/admin/styles/tokens.css`
- Create: `legacy/pages/admin/styles/layout.css`
- Create: `legacy/pages/admin/styles/navigation.css`
- Create: `legacy/pages/admin/styles/drive.css`
- Create: `legacy/pages/admin/styles/dialogs.css`
- Create: `legacy/pages/admin/styles/responsive.css`
- Modify: `test/legacy-storage-profile-ui.test.js`
- Modify: `e2e/storage-runtime.spec.js`
- Modify: `e2e/baseline.spec.js`

- [ ] **Step 1: Write failing legacy upload/admin tests**

Assert type-plus-instance selection, Guest Channel isolation, ordinary/URL/multipart
payload IDs, enqueue-time snapshots, remembered selection notices, exact Drive
filters, enabled migration targets, and profile labels.

- [ ] **Step 2: Verify RED** with the legacy DOM test and selected E2E cases.

- [ ] **Step 3: Extract the existing Vue 2 applications before adding behavior**

Move upload state/transports/history/auth, admin Drive/folders/dashboard/migration,
all component templates, and styles into the exact modules above. The root documents
become dependency/style includes plus one mount element, each below 300 lines. Each
listed JS/CSS file is also below 300 lines; split a responsibility again rather than
placing overflow back in the shells. Preserve existing element IDs, classes, and DOM
ordering through the extracted Vue 2 component templates.

- [ ] **Step 4: Add profile behavior through the shared legacy storage modules**

Mixins receive API/selection dependencies instead of importing globals. Queue items
store immutable `{ storageMode, storageId, storageName }`; admin actions always send
an exact ID. Do not add type-only fallback or expose admin profiles to guest upload.

- [ ] **Step 5: Verify GREEN and visual equivalence**

Run unit, build, legacy E2E, and desktop/mobile visual tests. Inspect every changed
baseline; only approved selectors, labels, and actions may differ.

- [ ] **Step 6: Commit**

```bash
git add index.html admin.html legacy/pages/upload legacy/pages/admin test/legacy-storage-profile-ui.test.js e2e
git commit -m "feat: select profiles in legacy upload and admin"
```
