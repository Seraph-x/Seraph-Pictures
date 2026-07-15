# WebDAV Profile Selector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let administrators select an enabled WebDAV storage profile on the legacy WebDAV page and bind status checks, file uploads, and URL uploads to that exact profile.

**Architecture:** Add a DOM-free profile controller and a small DOM view adapter under `legacy/pages/webdav/`. Reuse `LegacyStorageApi` for list/test requests and `LegacyUploadProfiles` for versioned selection memory and upload target helpers; keep `webdav.html` responsible only for markup, translations, and orchestration.

**Tech Stack:** Browser JavaScript, legacy HTML/CSS, Cloudflare Pages Storage API, Mocha, Node `assert`, Vite legacy-copy build.

---

## File Map

- Create `legacy/pages/webdav/profile-controller.js`: immutable WebDAV selection state, async list/test transitions, stale-result protection, upload snapshots.
- Create `legacy/pages/webdav/profile-view.js`: toolbar selector rendering, connection-card rendering, event binding, and combined availability/busy button state.
- Create `legacy/pages/webdav/profile.css`: desktop toolbar placement and narrow-screen wrapping.
- Create `test/legacy-webdav-profile-controller.test.js`: controller behavior and concurrency tests.
- Create `test/legacy-webdav-profile-page.test.js`: source/DOM contract, translations, payload wiring, and responsive layout tests.
- Modify `webdav.html`: load dependencies, add toolbar markup, register copy, mount controller/view, split operation and connection states, bind exact upload target.
- Modify `test/frontend-entrypoint.test.js`: update the built WebDAV contract from global `/api/status` to profile list/test assets.

### Task 1: WebDAV profile selection state

**Files:**
- Create: `test/legacy-webdav-profile-controller.test.js`
- Create: `legacy/pages/webdav/profile-controller.js`

- [ ] **Step 1: Write failing selection and snapshot tests**

Cover enabled-WebDAV filtering, remembered selection, default selection, first-enabled selection, invalid-memory fallback notice, empty state, list failure, and immutable snapshots. Use injected `api`, `selection`, `storage`, and `onChange` fakes.

```js
const controller = profiles.createController({
  api: { listProfiles: async () => ALL_PROFILES, testProfile: async () => ({ connected: true }) },
  selection: fakeSelection(), storage: memory('webdav-old'), onChange: states.push.bind(states),
});
await controller.load();
assert.equal(controller.getState().selectedId, 'webdav-default');
assert.equal(controller.getState().notice, 'STORAGE_PROFILE_SELECTION_RESET');
assert.deepEqual(controller.snapshot('Project/July'), {
  storageMode: 'webdav', storageId: 'webdav-default',
  storageName: 'Default DAV', folderPath: 'Project/July',
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npx mocha test/legacy-webdav-profile-controller.test.js --grep "selection|snapshot"`

Expected: FAIL because `legacy/pages/webdav/profile-controller.js` does not exist.

- [ ] **Step 3: Implement the minimal immutable controller state**

Expose CommonJS and browser globals:

```js
function createController(options) {
  let state = freezeState({ phase: 'idle', profiles: [], selectedId: '', notice: '', error: '', connection: idleConnection() });
  function publish(patch) {
    state = freezeState({ ...state, ...patch });
    options.onChange(state);
    return state;
  }
  return Object.freeze({ load, select, refresh, snapshot, getState: () => state });
}

const api = Object.freeze({ createController });
if (typeof module === 'object' && module.exports) module.exports = api;
globalThis.LegacyWebdavProfiles = api;
```

`load()` must retain only enabled `webdav` profiles and use `selection.readProfileMemory`. Resolve the profile inside this controller in the exact order `valid remembered → enabled default → first enabled`; emit `STORAGE_PROFILE_SELECTION_RESET` only when a non-empty remembered ID is invalid. Do not call `selection.resolveUploadSelection`, because that helper throws when enabled profiles exist without a default and therefore cannot satisfy this feature's confirmed first-enabled rule. Publish `ready`, `empty`, or `error` explicitly. `snapshot(folderPath)` must call `selection.snapshotUploadTarget` for the currently selected profile and throw `STORAGE_SELECTION_REQUIRED` otherwise.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npx mocha test/legacy-webdav-profile-controller.test.js --grep "selection|snapshot"`

Expected: all focused cases PASS.

- [ ] **Step 5: Commit the state model**

```bash
git add legacy/pages/webdav/profile-controller.js test/legacy-webdav-profile-controller.test.js
git commit -m "feat: model WebDAV upload profile selection"
```

### Task 2: Selected-profile connection checks

**Files:**
- Modify: `test/legacy-webdav-profile-controller.test.js`
- Modify: `legacy/pages/webdav/profile-controller.js`

- [ ] **Step 1: Write failing connection lifecycle tests**

Test that initial load tests the selected ID, `select(id)` remembers and tests the new ID, `refresh()` tests only the current ID, a rejected test publishes an explicit connection error without making `canUpload` false, and an older response cannot overwrite a newer selection.

```js
const first = deferred();
api.testProfile = (id) => id === 'webdav-a' ? first.promise : Promise.resolve({ connected: true });
await controller.load();
const switched = controller.select('webdav-b');
first.resolve({ connected: false, message: 'stale' });
await Promise.all([switched, first.promise]);
assert.equal(controller.getState().connection.profileId, 'webdav-b');
assert.equal(controller.getState().connection.result.connected, true);
assert.equal(controller.getState().canUpload, true);
```

- [ ] **Step 2: Run the new tests and verify RED**

Run: `npx mocha test/legacy-webdav-profile-controller.test.js --grep "connection|stale|refresh"`

Expected: FAIL because async test state and stale-result guards are incomplete.

- [ ] **Step 3: Implement token- and ID-guarded status checks**

Increment a private request token for every test. Publish a result only when both token and selected ID still match. Represent connection state as frozen `{ phase, profileId, result, error }`; do not change profile availability when testing rejects or returns `connected: false`. `load()` publishes the resolved selection, starts the initial connection request, and resolves without awaiting that request; `select()` and `refresh()` return their connection-test promises. This contract keeps page startup responsive and makes stale responses independently testable.

- [ ] **Step 4: Run the complete controller suite**

Run: `npx mocha test/legacy-webdav-profile-controller.test.js`

Expected: all controller cases PASS.

- [ ] **Step 5: Commit connection behavior**

```bash
git add legacy/pages/webdav/profile-controller.js test/legacy-webdav-profile-controller.test.js
git commit -m "feat: check selected WebDAV profile status"
```

### Task 3: Toolbar selector and view adapter

**Files:**
- Create: `legacy/pages/webdav/profile-view.js`
- Create: `legacy/pages/webdav/profile.css`
- Create: `test/legacy-webdav-profile-page.test.js`
- Modify: `webdav.html:50-53,183-242,797-824,900-1044`

- [ ] **Step 1: Write failing page and view contracts**

Assert that the toolbar order is `toolbar-left` → `webdavProfileTarget` → `toolbar-right`; the select contains a label and notice/error region; CSS gives the target `flex: 1` and a narrow-screen full row; scripts load `legacy/storage/api.js`, `legacy/pages/upload/profile-mixin.js`, controller, then view; Chinese and English keys cover target, default, loading, empty, load failure, fallback, checking, connected, and unavailable. Require the existing `I18n.onChange` callback to call `profileView.render(profileController.getState())` when both objects are initialized.

Also unit-test `createView({ elements, t })` with lightweight element fakes:

```js
view.render({ phase: 'empty', profiles: [], selectedId: '', canUpload: false, connection: { phase: 'idle' } });
assert.equal(elements.fileButton.disabled, true);
assert.equal(elements.urlButton.disabled, true);
assert.match(elements.notice.textContent, /noWebdavProfiles/);
```

- [ ] **Step 2: Run and verify RED**

Run: `npx mocha test/legacy-webdav-profile-page.test.js`

Expected: FAIL because selector assets and markup do not exist.

- [ ] **Step 3: Implement the view and toolbar markup**

The view API must remain DOM-focused:

```js
const view = createView({ elements, t });
view.bind({ onSelect: controller.select, onRefresh: controller.refresh });
view.render(controller.getState());
view.setUploadBusy(true);
```

`render()` rebuilds enabled options, adds the localized default suffix, shows one explicit notice/error, renders only connection state in `statusDetailText`, and sets both upload buttons to `busy || !state.canUpload`. It must not issue API calls or create selection state. The page's existing `I18n.onChange` handler must re-render the latest controller state so every JavaScript-built label changes language immediately.

- [ ] **Step 4: Run and verify GREEN**

Run: `npx mocha test/legacy-webdav-profile-page.test.js`

Expected: page and view cases PASS.

- [ ] **Step 5: Commit the selector UI**

```bash
git add webdav.html legacy/pages/webdav/profile-view.js legacy/pages/webdav/profile.css test/legacy-webdav-profile-page.test.js
git commit -m "feat: render WebDAV upload target selector"
```

### Task 4: Bind status and uploads to the selected profile

**Files:**
- Modify: `webdav.html:1047-1090,1279-1382,1459-1541`
- Modify: `test/legacy-webdav-profile-page.test.js`
- Modify: `test/frontend-entrypoint.test.js:102-110`

- [ ] **Step 1: Write failing orchestration and payload contracts**

Assert that page initialization creates `LegacyStorageApi.createStorageApi()`, the profile controller, and the view after authentication; removes `request("/api/status")`; calls `controller.refresh()` from the refresh button; and uses distinct `setOperationStatus()` and view-rendered connection status.

For uploads, assert the target is snapshotted before the file loop and reused:

```js
var target = profileController.snapshot(folderPath);
LegacyUploadProfiles.appendUploadTarget(form, target);
```

URL upload must use:

```js
body: JSON.stringify(LegacyUploadProfiles.buildUrlUploadPayload({ url: sourceUrl, target: target }))
```

- [ ] **Step 2: Run and verify RED**

Run: `npx mocha test/legacy-webdav-profile-page.test.js test/frontend-entrypoint.test.js --grep "WebDAV|webdav"`

Expected: FAIL on global status and missing exact-profile payload wiring.

- [ ] **Step 3: Implement minimal page orchestration**

Mount only after `ensureAuth()` succeeds. `load()` publishes the initial profile and starts its connection test; view updates arrive through `onChange`. Replace direct upload-button toggles with `profileView.setUploadBusy()` so empty/error states cannot be accidentally re-enabled in `finally`. Keep file-choice, upload progress, success, and upload errors in the top operation pill; connection results remain in the status card. Extend the existing `I18n.onChange` callback to re-render `profileController.getState()` without issuing a new API request.

- [ ] **Step 4: Run all WebDAV-focused tests**

Run: `npx mocha test/legacy-webdav-profile-controller.test.js test/legacy-webdav-profile-page.test.js`

Expected: all WebDAV-focused cases PASS.

- [ ] **Step 5: Commit exact-profile upload wiring**

```bash
git add webdav.html test/legacy-webdav-profile-page.test.js test/frontend-entrypoint.test.js
git commit -m "feat: bind WebDAV uploads to selected profile"
```

### Task 5: Build, regression verification, and review

**Files:**
- Verify generated copies under `frontend/dist/`; do not commit root `app/` build-only changes.
- Modify only files required by failures introduced by this feature.

- [ ] **Step 1: Run static and size checks**

Run: `git diff --check main...HEAD && wc -l legacy/pages/webdav/profile-controller.js legacy/pages/webdav/profile-view.js legacy/pages/webdav/profile.css test/legacy-webdav-profile-controller.test.js test/legacy-webdav-profile-page.test.js`

Expected: no whitespace errors; every new file is at most 300 lines.

- [ ] **Step 2: Build production assets**

Run: `npm run frontend:build`

Expected: Vite build and legacy copy succeed; built `frontend/dist/webdav.html` and `frontend/dist/legacy/pages/webdav/` contain the selector assets.

- [ ] **Step 3: Run focused and complete tests**

Run: `npx mocha test/legacy-webdav-profile-controller.test.js test/legacy-webdav-profile-page.test.js test/frontend-entrypoint.test.js`

Expected: all focused cases PASS.

Run with a 60-second hard timeout: `perl -e '$pid=fork(); if (!$pid) { exec @ARGV } $SIG{ALRM}=sub { kill 15,$pid; waitpid($pid,0); exit 124 }; alarm 60; waitpid($pid,0); exit($? >> 8)' npm test`

Expected: no new failures. Report the known pre-existing `theme.js` code-metrics failure separately if it remains.

- [ ] **Step 4: Request code review and resolve findings**

Use `@requesting-code-review`, then apply `@receiving-code-review` to verify and fix all Critical or Important findings. Re-run the affected focused tests after every correction.

- [ ] **Step 5: Clean build-only changes and commit final fixes**

Restore only build-generated root `app/` changes after verifying `frontend/dist`; preserve all unrelated user files. If review required source fixes, commit them with their regression tests. Finish with `git status -sb`, `git diff --check main...HEAD`, and fresh focused tests.
