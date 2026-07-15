const assert = require('node:assert/strict');

const MODULE_PATH = require.resolve('../legacy/pages/admin/drive-methods.js');

function loadDriveMethods() {
  const previous = global.LegacyAdminMixins;
  global.LegacyAdminMixins = [];
  delete require.cache[MODULE_PATH];
  require(MODULE_PATH);
  const methods = global.LegacyAdminMixins[0].methods;
  global.LegacyAdminMixins = previous;
  return methods;
}

function createContext(dialogVisible) {
  const calls = [];
  return {
    calls,
    folderMoveDialogVisible: dialogVisible,
    selectedFiles: [{ name: 'file-1' }],
    handleBatchCopy: () => calls.push('copy'),
    handleBatchDownload: () => calls.push('download'),
    moveSelectedToFolder: () => calls.push('move'),
    handleBatchDelete: () => calls.push('delete'),
    handleEscapeSelection: () => calls.push('escape'),
  };
}

function keyboardEvent(key, modifier = false) {
  return {
    key,
    target: { tagName: 'DIV', isContentEditable: false },
    ctrlKey: modifier,
    metaKey: false,
    prevented: false,
    preventDefault() { this.prevented = true; },
  };
}

describe('legacy Admin folder move keyboard isolation', function () {
  it('ignores every batch shortcut while the move dialog is visible', function () {
    const methods = loadDriveMethods();
    const context = createContext(true);
    const events = [
      keyboardEvent('Escape'), keyboardEvent('m'), keyboardEvent('Delete'),
      keyboardEvent('Backspace'), keyboardEvent('d'), keyboardEvent('c', true),
    ];

    for (const event of events) methods.handleGlobalKeydown.call(context, event);

    assert.deepEqual(context.calls, []);
    assert.equal(events.some((event) => event.prevented), false);
  });

  it('keeps existing batch shortcuts active when the dialog is closed', function () {
    const methods = loadDriveMethods();
    const context = createContext(false);
    const event = keyboardEvent('m');

    methods.handleGlobalKeydown.call(context, event);

    assert.deepEqual(context.calls, ['move']);
    assert.equal(event.prevented, true);
  });
});
