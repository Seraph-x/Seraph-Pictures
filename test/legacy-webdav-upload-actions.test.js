const assert = require('node:assert/strict');

const selection = require('../legacy/pages/upload/profile-mixin.js');

let actionsModule = null;
try {
  actionsModule = require('../legacy/pages/webdav/upload-actions.js');
} catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error;
}

function target(id, folderPath) {
  return Object.freeze({
    storageMode: 'webdav', storageId: id, storageName: id, folderPath,
  });
}

function createHarness(overrides = {}) {
  assert.ok(actionsModule, 'WebDAV upload actions module should exist');
  const bodies = [];
  const busy = [];
  let snapshotCalls = 0;
  const options = {
    profileController: {
      snapshot: (folderPath) => {
        snapshotCalls += 1;
        return target('dav-main', folderPath);
      },
    },
    profileView: { setUploadBusy: (value) => busy.push(value) },
    selection,
    FormDataClass: FormData,
    request: async (_url, init) => {
      bodies.push(init.body);
      return { src: '/uploaded' };
    },
    onProgress: () => {},
    onFileResult: () => {},
    ...overrides,
  };
  return {
    actions: actionsModule.createUploadActions(options),
    bodies, busy, snapshotCalls: () => snapshotCalls,
  };
}

describe('legacy WebDAV upload coordinator', function () {
  it('snapshots once and keeps one exact profile for the whole file batch', async function () {
    const harness = createHarness();
    await harness.actions.uploadFiles([
      new File(['first'], 'first.txt'), new File(['second'], 'second.txt'),
    ], 'Project/July');
    assert.equal(harness.snapshotCalls(), 1);
    assert.deepEqual(harness.bodies.map((body) => body.get('storageId')), ['dav-main', 'dav-main']);
    assert.deepEqual(harness.bodies.map((body) => body.get('folderPath')), [
      'Project/July', 'Project/July',
    ]);
    assert.deepEqual(harness.busy, [true, false]);
  });

  it('builds the URL request from the selected profile snapshot', async function () {
    const harness = createHarness();
    await harness.actions.uploadUrl('https://example.com/file.zip', 'Incoming');
    assert.equal(harness.snapshotCalls(), 1);
    assert.deepEqual(JSON.parse(harness.bodies[0]), {
      url: 'https://example.com/file.zip', storageMode: 'webdav',
      storageId: 'dav-main', folderPath: 'Incoming',
    });
    assert.deepEqual(harness.busy, [true, false]);
  });

  it('restores upload buttons and exposes request failures', async function () {
    const harness = createHarness({
      request: async () => { throw new Error('UPLOAD_FAILED'); },
    });
    await assert.rejects(
      harness.actions.uploadUrl('https://example.com/file.zip', ''),
      /UPLOAD_FAILED/,
    );
    assert.deepEqual(harness.busy, [true, false]);
  });
});
