const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function adminContext(files) {
  const sandbox = { window: {}, document: { location: { origin: 'https://example.test' } } };
  vm.createContext(sandbox);
  for (const file of files) vm.runInContext(fs.readFileSync(path.resolve('legacy/pages/admin', file), 'utf8'), sandbox);
  const mixins = sandbox.LegacyAdminMixins;
  return Object.assign({}, ...mixins.map((mixin) => mixin.data?.() || {}), ...mixins.map((mixin) => mixin.methods || {}));
}

describe('Legacy file presentation and list behavior', function () {
  let admin;
  beforeEach(function () {
    admin = adminContext(['state.js', 'drive-methods.js', 'drive-methods-2.js', 'lifecycle-methods.js', 'dashboard-methods.js']);
  });

  it('uses the original filename and MIME type for opaque storage IDs', function () {
    assert.equal(admin.getActualFileType({ name: 'r2:opaque', metadata: { fileName: 'Photo.JPG' } }), 'image');
    assert.equal(admin.getActualFileType({ name: 's3:opaque', metadata: { fileName: 'track.ogg', mimeType: 'audio/ogg' } }), 'audio');
    assert.equal(admin.getActualFileType({ name: 'r2:opaque', metadata: { fileName: 'clip', mimeType: 'video/mp4' } }), 'video');
    assert.equal(admin.getActualFileType('old-photo.jpg'), 'image');
  });

  it('opens PDF previews and type labels using the original filename', function () {
    const item = { name: 'r2:opaque', metadata: { fileName: 'Report.PDF' } };
    admin.openPreview(item);
    assert.equal(admin.previewData.type, 'iframe');
    assert.equal(admin.previewData.iframeUrl, 'https://example.test/file/r2:opaque');
    assert.equal(admin.getFileType(item), 'PDF');
    assert.equal(admin.getFileType({ name: 'r2:opaque', metadata: { fileName: 'README' } }), '—');
  });

  it('sorts by displayed filenames without mutating its input', function () {
    const files = [
      { name: 'a', metadata: { fileName: 'Zulu.txt' } },
      { name: 'z', metadata: { fileName: 'Alpha.txt' } },
    ];
    admin.sortOption = 'nameAsc';
    const sorted = admin.sortData(files);
    assert.equal(sorted[0].name, 'z');
    assert.notEqual(sorted, files);
    assert.equal(files[0].name, 'a');
  });

  it('preserves a saved filter with no matches instead of fetching and resetting silently', async function () {
    admin.tableData = [{ name: 'note.txt', metadata: { fileName: 'note.txt' } }];
    admin.filteredTableData = [];
    admin.fileType = 'audio';
    admin.folderPath = 'music';
    let requests = 0;
    admin.refreshFileList = async () => { requests++; };
    admin.switchFileType = () => {};
    admin.$message = { warning() {} };
    await admin.loadInitialAdminData();
    assert.equal(requests, 1);
    assert.equal(admin.fileType, 'audio');
    assert.equal(admin.folderPath, 'music');
  });
});
