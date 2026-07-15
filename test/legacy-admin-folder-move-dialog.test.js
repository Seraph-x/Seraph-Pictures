const assert = require('node:assert/strict');

const MODULE_PATH = require.resolve('../legacy/pages/admin/folder-move-methods.js');

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
});
