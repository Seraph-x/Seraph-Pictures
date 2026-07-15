const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const MODULE_PATH = require.resolve('../legacy/pages/admin/folder-move-methods.js');
const ROOT = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function loadFolderMoveMixin() {
  const previous = global.LegacyAdminMixins;
  global.LegacyAdminMixins = [];
  delete require.cache[MODULE_PATH];
  require(MODULE_PATH);
  const [mixin] = global.LegacyAdminMixins;
  global.LegacyAdminMixins = previous;
  return mixin;
}

function normalizePath(value) {
  return String(value || '').split('/').filter(Boolean).join('/');
}

function createMessages() {
  const entries = [];
  const message = {};
  for (const level of ['warning', 'info', 'success', 'error']) {
    message[level] = (value) => entries.push([level, value]);
  }
  return { entries, message };
}

function createContext(overrides = {}) {
  const notifications = createMessages();
  const mixin = loadFolderMoveMixin();
  return {
    ...mixin.data(),
    ...mixin.methods,
    folders: [{ path: 'archive' }],
    folderPath: 'photos',
    selectedFiles: [{ name: 'file-1' }],
    tableData: [{ name: 'file-1', metadata: { folderPath: 'photos' } }],
    normalizeFolderPath: normalizePath,
    t: (key) => key,
    $message: notifications.message,
    notifications: notifications.entries,
    ...overrides,
  };
}

describe('legacy Admin folder move dialog', function () {
  it('starts with closed immutable dialog state', function () {
    const mixin = loadFolderMoveMixin();

    assert.deepEqual(mixin.data(), {
      folderMoveDialogVisible: false,
      folderMoveTarget: '',
      folderMovePending: false,
    });
  });

  it('builds root and normalized suggestions in sidebar order', function () {
    const mixin = loadFolderMoveMixin();
    const folders = [
      { path: 'alpha/child' },
      { folderPath: '/zeta/' },
      { path: '/alpha/child/' },
    ];
    const context = {
      folders,
      normalizeFolderPath: normalizePath,
      t: () => 'Root',
    };

    assert.deepEqual(mixin.computed.folderMoveSuggestions.call(context), [
      { value: '', label: 'Root' },
      { value: 'zeta', label: 'zeta' },
      { value: 'alpha/child', label: 'alpha/child' },
    ]);
    assert.deepEqual(folders, [
      { path: 'alpha/child' },
      { folderPath: '/zeta/' },
      { path: '/alpha/child/' },
    ]);
  });

  it('filters suggestions by case-insensitive label and value', function () {
    const { methods } = loadFolderMoveMixin();
    const suggestions = [
      { value: '', label: 'Root' },
      { value: 'Photos/2026', label: 'Photos/2026' },
      { value: 'archive', label: 'archive' },
    ];
    let matches;

    methods.queryFolderMoveSuggestions.call(
      { folderMoveSuggestions: suggestions },
      'PHOTOS',
      (items) => { matches = items; },
    );

    assert.deepEqual(matches, [suggestions[1]]);
  });

  it('returns all suggestions for an empty query', function () {
    const { methods } = loadFolderMoveMixin();
    const suggestions = [{ value: '', label: 'Root' }, { value: 'archive', label: 'archive' }];
    let matches;

    methods.queryFolderMoveSuggestions.call(
      { folderMoveSuggestions: suggestions },
      '',
      (items) => { matches = items; },
    );

    assert.strictEqual(matches, suggestions);
  });

  it('selects root and existing folder suggestion values', function () {
    const { methods } = loadFolderMoveMixin();
    const context = { folderMoveTarget: 'previous' };

    methods.selectFolderMoveSuggestion.call(context, { value: '' });
    assert.equal(context.folderMoveTarget, '');
    methods.selectFolderMoveSuggestion.call(context, { value: 'archive' });
    assert.equal(context.folderMoveTarget, 'archive');
  });

  it('opens with the current normalized folder', function () {
    const { methods } = loadFolderMoveMixin();
    const context = createContext({ folderPath: '/photos/2026/' });

    methods.promptFolderMove.call(context);

    assert.equal(context.folderMoveTarget, 'photos/2026');
    assert.equal(context.folderMoveDialogVisible, true);
  });

  it('cancel leaves files and folders unchanged without a request', function () {
    const { methods } = loadFolderMoveMixin();
    const context = createContext({ folderMoveDialogVisible: true, folderMoveTarget: 'archive' });
    const rows = structuredClone(context.tableData);
    const folders = structuredClone(context.folders);
    let requests = 0;
    context.requestFolderMove = () => { requests += 1; };

    methods.closeFolderMoveDialog.call(context);

    assert.equal(requests, 0);
    assert.deepEqual(context.tableData, rows);
    assert.deepEqual(context.folders, folders);
    assert.equal(context.folderMoveDialogVisible, false);
    assert.equal(context.folderMoveTarget, '');
  });

  it('cancel is blocked while a move is pending', function () {
    const { methods } = loadFolderMoveMixin();
    const context = createContext({
      folderMoveDialogVisible: true,
      folderMoveTarget: 'archive',
      folderMovePending: true,
    });
    let closed = false;

    methods.closeFolderMoveDialog.call(context, () => { closed = true; });

    assert.equal(closed, false);
    assert.equal(context.folderMoveDialogVisible, true);
    assert.equal(context.folderMoveTarget, 'archive');
  });

  it('refuses to open without selected files', function () {
    const { methods } = loadFolderMoveMixin();
    const context = createContext({ selectedFiles: [] });

    methods.promptFolderMove.call(context);

    assert.equal(context.folderMoveDialogVisible, false);
    assert.deepEqual(context.notifications, [['warning', 'admin.selectFilesFirst']]);
  });

  it('confirms unmatched visible text as a new normalized path', async function () {
    const { methods } = loadFolderMoveMixin();
    const context = createContext({ folderMoveDialogVisible: true, folderMoveTarget: '/new/archive/' });
    let request;
    context.performFolderMove = async (options) => { request = options; return true; };

    await methods.confirmFolderMove.call(context);

    assert.deepEqual(request, { ids: ['file-1'], targetFolderPath: 'new/archive' });
    assert.equal(context.folderMoveDialogVisible, false);
  });

  it('submits an existing suggestion selected from the list', async function () {
    const { methods } = loadFolderMoveMixin();
    const context = createContext({ folderMoveDialogVisible: true });
    let request;
    context.performFolderMove = async (options) => { request = options; return true; };

    methods.selectFolderMoveSuggestion.call(context, { value: 'archive' });
    await methods.confirmFolderMove.call(context);

    assert.deepEqual(request, { ids: ['file-1'], targetFolderPath: 'archive' });
  });

  it('snapshots root move IDs and blocks duplicate confirmation', async function () {
    const { methods } = loadFolderMoveMixin();
    const context = createContext({ folderMoveDialogVisible: true, folderMoveTarget: '' });
    let resolveMove;
    const requests = [];
    context.performFolderMove = (options) => {
      requests.push(options);
      return new Promise((resolve) => { resolveMove = resolve; });
    };

    const first = methods.confirmFolderMove.call(context);
    context.selectedFiles.push({ name: 'file-2' });
    const duplicate = methods.confirmFolderMove.call(context);
    resolveMove(true);
    await Promise.all([first, duplicate]);

    assert.deepEqual(requests, [{ ids: ['file-1'], targetFolderPath: '' }]);
  });

  it('closes with information when files already use the target folder', async function () {
    const { methods } = loadFolderMoveMixin();
    const context = createContext({ folderMoveDialogVisible: true, folderMoveTarget: 'photos' });
    context.performFolderMove = async () => false;

    await methods.confirmFolderMove.call(context);

    assert.equal(context.folderMoveDialogVisible, false);
    assert.deepEqual(context.notifications, [['info', 'admin.filesAlreadyInFolder']]);
  });

  it('restores rows and folders after a failed request and stays retryable', async function () {
    const { methods } = loadFolderMoveMixin();
    const context = createContext({ folderMoveDialogVisible: true, folderMoveTarget: 'archive' });
    const rows = structuredClone(context.tableData);
    const folders = structuredClone(context.folders);
    context.cloneFoldersSnapshot = () => structuredClone(context.folders);
    context.updateStats = () => {};
    context.requestFolderMove = async () => { throw new Error('network failed'); };
    context.clearFolderCache = () => {};
    context.fetchFolders = async () => {};

    await methods.confirmFolderMove.call(context);

    assert.deepEqual(context.tableData, rows);
    assert.deepEqual(context.folders, folders);
    assert.equal(context.folderMoveDialogVisible, true);
    assert.equal(context.folderMoveTarget, 'archive');
    assert.equal(context.folderMovePending, false);
    assert.deepEqual(context.notifications, [['error', 'network failed']]);
  });

  it('renders the guarded autocomplete dialog template', function () {
    const relativePath = 'legacy/pages/admin/components/folder-move-dialog.js';
    assert.ok(fs.existsSync(path.join(ROOT, relativePath)), 'folder move dialog must exist');
    const dialog = read(relativePath);
    for (const pattern of [
      /:visible\.sync="folderMoveDialogVisible"/, /v-model="folderMoveTarget"/,
      /:fetch-suggestions="queryFolderMoveSuggestions"/, /@select="selectFolderMoveSuggestion"/,
      /:before-close="closeFolderMoveDialog"/, /:close-on-click-modal="!folderMovePending"/,
      /:close-on-press-escape="!folderMovePending"/, /@click="confirmFolderMove"/,
    ]) assert.match(dialog, pattern);
  });

  it('loads and composes the folder move dialog before the Admin app closes', function () {
    const html = read('admin.html');
    const app = read('legacy/pages/admin/app.js');
    const script = '/legacy/pages/admin/components/folder-move-dialog.js';
    const scriptIndex = html.indexOf(script);
    const appIndex = html.indexOf('/legacy/pages/admin/app.js');
    const dialogIndex = app.indexOf('folderMoveDialog');
    const toolbarIndex = app.indexOf('fileToolbar');

    assert.notEqual(scriptIndex, -1);
    assert.notEqual(dialogIndex, -1);
    assert.ok(scriptIndex < appIndex);
    assert.ok(dialogIndex < toolbarIndex);
  });
});
