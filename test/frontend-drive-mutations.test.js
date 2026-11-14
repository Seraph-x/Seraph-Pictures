const assert = require('node:assert/strict');

describe('Drive operation feedback', function () {
  let useDriveMutations;
  let previousWindow;
  let previousNavigator;
  before(async function () {
    ({ useDriveMutations } = await import('../frontend/src/composables/drive/useDriveMutations.js'));
  });
  beforeEach(function () {
    previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { confirm: () => true } });
  });
  afterEach(function () {
    for (const [key, descriptor] of [['window', previousWindow], ['navigator', previousNavigator]]) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });

  function create(api = {}) {
    const state = {
      error: { value: '' }, message: { value: 'old success' }, currentPath: { value: 'photos/2026' },
      selectedFileIds: { value: [] }, refreshes: 0,
    };
    const actions = useDriveMutations({
      ...state, api, t: (key) => key, fileLink: (id) => `/file/${id}`,
      refreshAll: async () => { state.refreshes += 1; },
    });
    return { state, actions };
  }

  it('offers recursive deletion for the current backend error code', async function () {
    const calls = [];
    const { state, actions } = create({ deleteFolder: async (path, recursive) => {
      calls.push({ path, recursive });
      if (!recursive) throw new Error('DRIVE_FOLDER_NOT_EMPTY');
    } });
    await actions.deleteFolder({ path: 'photos', name: 'Photos' });
    assert.deepEqual(calls, [{ path: 'photos', recursive: false }, { path: 'photos', recursive: true }]);
    assert.equal(state.currentPath.value, '');
    assert.equal(state.refreshes, 1);
    assert.equal(state.message.value, '');
  });

  it('reports recursive deletion failure without refreshing or changing the path', async function () {
    const { state, actions } = create({ deleteFolder: async (_path, recursive) => {
      throw new Error(recursive ? 'REMOTE_DELETE_FAILED' : 'Folder not empty');
    } });
    await actions.deleteFolder({ path: 'photos', name: 'Photos' });
    assert.equal(state.error.value, 'REMOTE_DELETE_FAILED');
    assert.equal(state.currentPath.value, 'photos/2026');
    assert.equal(state.refreshes, 0);
  });

  it('keeps the current path when deleting a folder that only shares its name prefix', async function () {
    const { state, actions } = create({ deleteFolder: async () => {} });
    state.currentPath.value = 'photos-backup/2026';
    await actions.deleteFolder({ path: 'photos', name: 'Photos' });
    assert.equal(state.currentPath.value, 'photos-backup/2026');
  });

  it('leaves a nonempty folder alone when recursive deletion is declined', async function () {
    const confirmations = [true, false];
    globalThis.window.confirm = () => confirmations.shift();
    let calls = 0;
    const { state, actions } = create({ deleteFolder: async () => {
      calls += 1;
      throw new Error('DRIVE_FOLDER_NOT_EMPTY');
    } });
    await actions.deleteFolder({ path: 'photos', name: 'Photos' });
    assert.equal(calls, 1);
    assert.equal(state.error.value, '');
    assert.equal(state.refreshes, 0);
  });

  it('shows clipboard errors instead of keeping a previous success message', async function () {
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
      clipboard: { writeText: async () => { throw new Error('CLIPBOARD_DENIED'); } },
    } });
    const { state, actions } = create();
    await actions.copyDirect({ name: 'file' });
    assert.equal(state.error.value, 'CLIPBOARD_DENIED');
    assert.equal(state.message.value, '');
    assert.equal(state.refreshes, 0);
  });
});
