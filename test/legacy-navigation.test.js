const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function keyboardContext() {
  const sandbox = {};
  vm.runInNewContext(fs.readFileSync('frontend/scripts/pages/admin/drive-methods.js', 'utf8'), sandbox);
  return { ...sandbox.LegacyAdminMixins[0].methods, selectedFiles: [{ name: 'file' }] };
}

describe('Legacy navigation keyboard ownership', function () {
  it('does not clear file selections when Escape belongs to a menu', function () {
    const context = keyboardContext();
    let cleared = false;
    context.clearSelection = () => { cleared = true; };
    context.handleGlobalKeydown({ key: 'Escape', target: { tagName: 'BUTTON', closest: () => ({}) }, preventDefault() {} });
    assert.equal(cleared, false);
  });

  it('lets native storage selectors handle letter keys', function () {
    const context = keyboardContext();
    let downloaded = false;
    context.handleBatchDownload = () => { downloaded = true; };
    context.handleGlobalKeydown({ key: 'd', target: { tagName: 'SELECT' }, preventDefault() {} });
    assert.equal(downloaded, false);
  });

  it('still clears selections when Escape belongs to the file grid', function () {
    const context = keyboardContext();
    let cleared = false;
    context.clearSelection = () => { cleared = true; };
    context.handleGlobalKeydown({ key: 'Escape', target: { tagName: 'DIV' }, preventDefault() {} });
    assert.equal(cleared, true);
  });
});
