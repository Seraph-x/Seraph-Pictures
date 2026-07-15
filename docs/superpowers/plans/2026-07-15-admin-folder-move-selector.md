# Admin Batch Folder Move Selector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the legacy Admin batch move prompt with an autocomplete dialog that lists existing folders, supports root, and accepts new paths.

**Architecture:** Keep state, immutable option projection, and confirmation logic in `folder-move-methods.js`. Add one template-only dialog component and retain the existing `performFolderMove` transaction and `/api/drive/files/move` contract.

**Tech Stack:** Vue 2 global mixins, Element UI, Node.js/Mocha, Vite legacy build.
---

## File map

- Create `legacy/pages/admin/components/folder-move-dialog.js`: dialog template only.
- Create `test/legacy-admin-folder-move-dialog.test.js`: mixin and template contracts.
- Modify `legacy/pages/admin/folder-move-methods.js`: dialog state and workflow.
- Modify `legacy/pages/admin/app.js`: compose the dialog.
- Modify `admin.html`: load the component before `app.js`.
- Modify `legacy/pages/admin/i18n-2.js` and `i18n-3.js`: equivalent Chinese/English labels.
- Regenerate `frontend/dist/` with the existing build; never hand-edit copied artifacts.

### Task 0: Isolate the implementation
- [ ] **Step 1: Create a clean worktree**
Use the `using-git-worktrees` skill from the commit containing this plan. The original workspace has unrelated generated `app/` and untracked files; do not implement there.
- [ ] **Step 2: Verify and record the exact base**
Run `git status -sb` and `git rev-parse HEAD` in the worktree. Expected: clean status on a feature branch; save the printed hash as the review base.

### Task 1: Destination model and suggestions

**Files:**
- Create: `test/legacy-admin-folder-move-dialog.test.js`
- Modify: `legacy/pages/admin/folder-move-methods.js`

- [ ] **Step 1: Write failing state and suggestion tests**

Load the mixin with a fresh `global.LegacyAdminMixins`. Assert `data()` returns closed/empty/not-pending state. Use `zeta`, `alpha/child`, duplicates, and slash-padded paths; assert root first, then depth-before-path ordering, normalization/deduplication, and unchanged input.

```js
assert.deepStrictEqual(mixin.computed.folderMoveSuggestions.call(context), [
  { value: '', label: 'Root' },
  { value: 'zeta', label: 'zeta' },
  { value: 'alpha/child', label: 'alpha/child' },
]);
```

- [ ] **Step 2: Verify RED**

Run: `npx mocha test/legacy-admin-folder-move-dialog.test.js --grep "state|suggestions"`

Expected: FAIL because the dialog model does not exist.

- [ ] **Step 3: Add minimal data and computed projection**

Add `data()` to the existing folder-move mixin rather than expanding 298-line `state.js`:

```js
data() {
  return { folderMoveDialogVisible: false, folderMoveTarget: '', folderMovePending: false };
},
computed: {
  folderMoveSuggestions() {
    const paths = (this.folders || [])
      .map((folder) => this.normalizeFolderPath(folder.path || folder.folderPath || ''))
      .filter(Boolean);
    const unique = [...new Set(paths)].sort((a, b) => {
      const depth = (value) => value.split('/').length;
      return depth(a) - depth(b) || a.localeCompare(b, 'zh-CN');
    });
    const root = Object.freeze({ value: '', label: this.t('admin.rootDir') });
    return Object.freeze([root, ...unique.map((value) => Object.freeze({ value, label: value }))]);
  },
},
```

- [ ] **Step 4: Write failing filtering/selection tests**

Test empty query, case-insensitive matching, root selection, and folder selection.

- [ ] **Step 5: Verify RED**

Run: `npx mocha test/legacy-admin-folder-move-dialog.test.js --grep "query|selection"`

Expected: FAIL because query and selection methods do not exist.

- [ ] **Step 6: Implement filtering/selection**

```js
queryFolderMoveSuggestions(query, callback) {
  const text = String(query || '').trim().toLocaleLowerCase();
  const matches = text ? this.folderMoveSuggestions.filter((item) => {
    return `${item.label} ${item.value}`.toLocaleLowerCase().includes(text);
  }) : this.folderMoveSuggestions;
  callback(matches);
},
selectFolderMoveSuggestion(item) {
  this.folderMoveTarget = item.value;
},
```

Run the same command. Expected: PASS.

- [ ] **Step 7: Commit**
```bash
git add test/legacy-admin-folder-move-dialog.test.js legacy/pages/admin/folder-move-methods.js
git commit -m "test: define admin folder move destinations"
```

### Task 2: Dialog lifecycle and confirmation

- [ ] **Step 1: Write failing open/cancel tests**

Assert no selection warns and stays closed; a valid selection opens with normalized `folderPath`; cancel sends no request, leaves rows/folders unchanged, and resets dialog state; pending state blocks close and does not invoke `done`.

- [ ] **Step 2: Verify RED**

Run: `npx mocha test/legacy-admin-folder-move-dialog.test.js --grep "opens|cancel"`

Expected: FAIL because `promptFolderMove` still invokes `$prompt`.

- [ ] **Step 3: Implement lifecycle methods**

```js
resetFolderMoveDialog() {
  this.folderMoveDialogVisible = false;
  this.folderMoveTarget = '';
},
promptFolderMove() {
  if (!this.selectedFiles.length) {
    this.$message.warning(this.t('admin.selectFilesFirst'));
    return;
  }
  this.folderMoveTarget = this.normalizeFolderPath(this.folderPath || '');
  this.folderMoveDialogVisible = true;
},
closeFolderMoveDialog(done) {
  if (this.folderMovePending) return;
  this.resetFolderMoveDialog();
  if (typeof done === 'function') done();
},
```

- [ ] **Step 4: Write failing confirm tests**

Use a deferred move to cover unmatched visible text, an existing suggestion submitted end-to-end, root as `''`, snapshotted IDs, duplicate-confirm blocking, success close, and same-folder close/info. For failure, call the real `performFolderMove` with `requestFolderMove` rejecting; assert its optimistic row/folder changes roll back while the target/dialog remain available and pending clears.

- [ ] **Step 5: Verify RED**

Run: `npx mocha test/legacy-admin-folder-move-dialog.test.js --grep "confirm|root|retry|same-folder"`

Expected: FAIL because `confirmFolderMove` is absent.

- [ ] **Step 6: Implement delegated confirmation**

```js
async confirmFolderMove() {
  if (this.folderMovePending) return;
  const targetFolderPath = this.normalizeFolderPath(this.folderMoveTarget || '');
  const ids = this.selectedFiles.map((item) => item.name);
  this.folderMovePending = true;
  try {
    const moved = await this.performFolderMove({ ids, targetFolderPath });
    if (!moved) {
      this.$message.info(this.t('admin.filesAlreadyInFolder'));
      this.resetFolderMoveDialog();
      return;
    }
    const folder = targetFolderPath || this.t('admin.rootDir');
    this.$message.success(this.t('admin.movedNToFolder', { n: ids.length, folder }));
    this.resetFolderMoveDialog();
  } catch (error) {
    this.$message.error(error?.message || this.t('admin.moveFilesFailed'));
  } finally {
    this.folderMovePending = false;
  }
},
```

Do not bind Enter to confirmation; Enter remains autocomplete selection only, avoiding duplicate moves.

- [ ] **Step 7: Verify and commit**

Run: `npx mocha test/legacy-admin-folder-move-dialog.test.js`

Expected: PASS.

```bash
git add test/legacy-admin-folder-move-dialog.test.js legacy/pages/admin/folder-move-methods.js
git commit -m "feat: manage admin folder move dialog"
```

### Task 3: Render and load the dialog

- [ ] **Step 1: Write failing template/load tests**

Assert the template binds `folderMoveDialogVisible`, `folderMoveTarget`, suggestion query/select methods, guarded modal/Escape closing, pending state, and `confirmFolderMove`. Assert `admin.html` loads the component before `app.js`; assert `app.js` composes it before `fileToolbar` (which closes the root node).

- [ ] **Step 2: Verify RED**

Run: `npx mocha test/legacy-admin-folder-move-dialog.test.js --grep "template|loads|composes"`

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Create the template component**

```js
globalThis.LegacyAdminComponents.folderMoveDialog = `
  <el-dialog :title="t('admin.moveFilesTitle')" :visible.sync="folderMoveDialogVisible"
    width="520px" append-to-body :before-close="closeFolderMoveDialog"
    :close-on-click-modal="!folderMovePending" :close-on-press-escape="!folderMovePending"
    :show-close="!folderMovePending" custom-class="folder-move-dialog">
    <p>{{ t('admin.moveFolderDestinationHint') }}</p>
    <el-autocomplete v-model="folderMoveTarget" :fetch-suggestions="queryFolderMoveSuggestions"
      :placeholder="t('admin.moveFolderDestinationPlaceholder')" style="width:100%;"
      @select="selectFolderMoveSuggestion">
      <template slot-scope="{ item }"><span>{{ item.label }}</span></template>
    </el-autocomplete>
    <span slot="footer" class="dialog-footer">
      <el-button :disabled="folderMovePending" @click="closeFolderMoveDialog()">{{ t('admin.cancel') }}</el-button>
      <el-button type="primary" :loading="folderMovePending" @click="confirmFolderMove">{{ t('admin.confirmMove') }}</el-button>
    </span>
  </el-dialog>`;
```

- [ ] **Step 4: Wire, verify, and commit**

Load the new script with other component scripts before `app.js`; compose it immediately before `fileToolbar`.

Run: `npx mocha test/legacy-admin-folder-move-dialog.test.js --grep "template|loads|composes"`

Expected: PASS.

```bash
git add admin.html legacy/pages/admin/app.js legacy/pages/admin/components/folder-move-dialog.js test/legacy-admin-folder-move-dialog.test.js
git commit -m "feat: render admin folder move selector"
```

### Task 4: Localize and validate

- [ ] **Step 1: Write and run failing bilingual tests**

Require non-empty Chinese and English entries for existing move labels plus the two new keys. Run:

`npx mocha test/legacy-admin-folder-move-dialog.test.js --grep "localized"`

Expected: FAIL for the new keys.

- [ ] **Step 2: Add equivalent copy**

Add `admin.moveFolderDestinationHint` as `选择现有目录，或直接输入新的目录路径。` / `Choose an existing folder or enter a new folder path.` Add `admin.moveFolderDestinationPlaceholder` as `搜索或输入目录路径；留空为根目录` / `Search or enter a folder path; leave empty for root`.

- [ ] **Step 3: Run focused and full tests**

Run: `npx mocha test/legacy-admin-folder-move-dialog.test.js`

Expected: PASS.

Run with the required 60-second timeout:

```bash
perl -e '$pid=fork(); if (!$pid) { exec @ARGV } $SIG{ALRM}=sub { kill 15,$pid; waitpid($pid,0); exit 124 }; alarm 60; waitpid($pid,0); exit($? >> 8)' npm test
```

Expected: all tests pass. If the accepted pre-existing `theme.js` metric failure remains, report it without altering or suppressing it.

- [ ] **Step 4: Build and verify copied assets**

Run `npm run frontend:build`. Expected: Vite and legacy copy exit 0. The build intentionally writes ignored `frontend/dist/` and synchronizes tracked `app/`; this feature changes only legacy Admin assets, so `app/` output is not part of its commit.

Run: `rg -n "folderMoveDialogVisible|moveFolderDestinationPlaceholder" frontend/dist/legacy/pages/admin frontend/dist/legacy/admin.html`

Expected: component, mixin, i18n, and Admin shell matches.

- [ ] **Step 5: Remove build-only workspace output**

Run `git check-ignore frontend/dist/index.html` to confirm `frontend/dist/` is ignored. Inspect `git diff --stat -- app`, then run `git restore --worktree app` in the isolated worktree to remove only artifacts generated by Step 4. Do not run this cleanup in the original dirty workspace.

- [ ] **Step 6: Check and commit exact scope**

Run `git diff --check` and `git status -sb`. Expected: only intended source/tests remain; `frontend/dist/`, `app/`, `.superpowers/`, and unrelated files are absent from the diff.

```bash
git add legacy/pages/admin/i18n-2.js legacy/pages/admin/i18n-3.js test/legacy-admin-folder-move-dialog.test.js
git commit -m "feat: localize folder move selector"
```

### Task 5: Final local review

- [ ] **Step 1: Review implementation scope**

Run `git diff --stat main...HEAD` and `git log --oneline main..HEAD`.

Expected: only approved selector, tests, and translations; no generated or unrelated files.

- [ ] **Step 2: Fresh final verification**

Run `npx mocha test/legacy-admin-folder-move-dialog.test.js`, then the 60-second full test command from Task 4. Expected: focused tests pass; report the accepted pre-existing `theme.js` metric failure separately if it persists.

- [ ] **Step 3: Verify final repository state**

Run `git status -sb` and `git diff --check main...HEAD`. Expected: clean implementation worktree and no whitespace errors. Pushing, integration, and production deployment are explicitly out of scope for this approved feature plan.
