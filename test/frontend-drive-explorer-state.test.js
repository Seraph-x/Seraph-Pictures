const assert = require('node:assert/strict');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function page(names, cursor = null) {
  return {
    files: names.map((name) => ({ name })), folders: [],
    cursor, list_complete: cursor === null,
  };
}

describe('Drive explorer query and navigation state', function () {
  let useDriveExplorer;
  before(async function () {
    ({ useDriveExplorer } = await import('../frontend/src/composables/drive/useDriveExplorer.js'));
  });

  function create(api = {}) {
    return useDriveExplorer({
      t: (key) => key,
      api: { getDriveTree: async () => [], getDriveExplorer: async () => page([]), ...api },
    });
  }

  it('paginates the submitted query while a different search is still being typed', async function () {
    const requests = [];
    const explorer = create({ getDriveExplorer: async (query) => {
      requests.push(query);
      return page([query.cursor ? 'second' : 'first'], query.cursor ? null : 'next');
    } });
    explorer.search.value = 'submitted';
    await explorer.reloadExplorer();
    explorer.search.value = 'draft';
    await explorer.loadMore();
    assert.equal(requests[1].search, 'submitted');
    assert.equal(requests[1].cursor, 'next');
    assert.equal(explorer.appliedSearch.value, 'submitted');
    assert.deepEqual(explorer.files.value.map((file) => file.name), ['first', 'second']);
  });

  it('clears old files and selection immediately when navigating, even if loading fails', async function () {
    const pending = deferred();
    const explorer = create({ getDriveExplorer: async ({ path }) => path ? pending.promise : page(['old']) });
    await explorer.reloadExplorer();
    explorer.toggleFileSelection('old');
    const navigation = explorer.openPath('photos/2026');
    const duringLoad = {
      files: [...explorer.files.value], selected: [...explorer.selectedFileIds.value],
      breadcrumbs: explorer.breadcrumbs.value.map((crumb) => crumb.path),
    };
    pending.reject(new Error('DIRECTORY_UNAVAILABLE'));
    await navigation;
    assert.deepEqual(duringLoad, { files: [], selected: [], breadcrumbs: ['', 'photos', 'photos/2026'] });
    assert.equal(explorer.explorerError.value, 'DIRECTORY_UNAVAILABLE');
    assert.equal(explorer.loading.value, false);
  });

  it('does not request a page before initial load, during loading, or after the last page', async function () {
    const pending = deferred();
    let requests = 0;
    const explorer = create({ getDriveExplorer: async () => { requests += 1; return pending.promise; } });
    const before = explorer.loadMore();
    const beforeCount = requests;
    const first = explorer.reloadExplorer();
    const during = explorer.loadMore();
    const duringCount = requests;
    pending.resolve(page(['only']));
    await Promise.all([before, first, during]);
    await explorer.loadMore();
    assert.equal(beforeCount, 0);
    assert.equal(duringCount, 1);
    assert.equal(requests, 1);
  });

  it('keeps the latest folder tree when older profile requests finish later', async function () {
    const pending = deferred();
    const explorer = create({ getDriveTree: async ({ storageId }) => (
      storageId ? [{ path: 'new' }] : pending.promise
    ) });
    const old = explorer.refreshAll();
    explorer.storageId.value = 'archive';
    await explorer.refreshAll();
    pending.resolve([{ path: 'old' }]);
    await old;
    assert.deepEqual(explorer.treeNodes.value.map((node) => node.path), ['new']);
  });

  it('ignores errors from an obsolete folder tree request', async function () {
    const pending = deferred();
    const explorer = create({ getDriveTree: async ({ storageId }) => storageId ? [] : pending.promise });
    const old = explorer.refreshAll();
    explorer.storageId.value = 'archive';
    await explorer.refreshAll();
    pending.reject(new Error('OLD_PROFILE_FAILED'));
    await old;
    assert.equal(explorer.error.value, '');
    assert.equal(explorer.treeError.value, '');
  });

  it('keeps tree and explorer failures separate and retries only the failed tree', async function () {
    let treeAttempts = 0;
    let pageAttempts = 0;
    const explorer = create({
      getDriveTree: async () => {
        treeAttempts += 1;
        if (treeAttempts === 1) throw new Error('TREE_FAILED');
        return [{ path: 'photos' }];
      },
      getDriveExplorer: async () => { pageAttempts += 1; return page(['kept']); },
    });
    await explorer.refreshAll();
    assert.equal(explorer.treeError?.value, 'TREE_FAILED');
    assert.equal(explorer.explorerError.value, '');
    await explorer.reloadTree();
    assert.equal(explorer.treeError.value, '');
    assert.equal(pageAttempts, 1);
    assert.deepEqual(explorer.files.value.map((file) => file.name), ['kept']);
  });

  it('keeps loaded pages on pagination failure and retries the same cursor and query', async function () {
    const requests = [];
    const explorer = create({ getDriveExplorer: async (query) => {
      requests.push(query);
      if (requests.length === 2) throw new Error('PAGE_FAILED');
      return query.cursor ? page(['second']) : page(['first'], 'next');
    } });
    explorer.search.value = 'submitted';
    await explorer.reloadExplorer();
    await explorer.loadMore();
    assert.deepEqual(explorer.files.value.map((file) => file.name), ['first']);
    assert.equal(explorer.nextCursor.value, 'next');
    assert.equal(explorer.explorerError?.value, 'PAGE_FAILED');
    explorer.search.value = 'draft';
    await explorer.retryExplorer();
    assert.equal(requests[2].search, 'submitted');
    assert.equal(requests[2].cursor, 'next');
    assert.equal(explorer.explorerError.value, '');
    assert.deepEqual(explorer.files.value.map((file) => file.name), ['first', 'second']);
  });

  it('keeps descendants immediately after their parent instead of sorting all roots first', async function () {
    const paths = ['zoo', 'photos/2026', 'photos', '', 'photos/2026/trip', 'photos-old'];
    const explorer = create({ getDriveTree: async () => paths.map((path) => ({ path })) });
    await explorer.refreshAll();
    assert.deepEqual(explorer.flatTreeNodes.value.map((node) => node.path), [
      '', 'photos', 'photos/2026', 'photos/2026/trip', 'photos-old', 'zoo',
    ]);
  });
});
