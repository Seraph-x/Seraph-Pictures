const assert = require('node:assert');

const TARGET = Object.freeze({
  storageMode: 'r2',
  storageId: 'r2-archive',
  storageName: 'Archive R2',
  targetFolderPath: 'photos/2026',
});

describe('frontend profile-bound upload payloads', function () {
  let queueModule;
  let transportModule;

  before(async function () {
    queueModule = await import('../frontend/src/composables/upload/useUploadQueue.js');
    transportModule = await import('../frontend/src/composables/upload/useUploadTransport.js');
  });

  it('snapshots the exact profile and instance label when a file enters the queue', function () {
    const source = { ...TARGET };
    const item = queueModule.createUploadQueueItem({
      id: 'queue-1', file: { name: 'photo.png', size: 3 }, target: source,
      imageProcessingOptions: { enabled: false },
    });
    source.storageId = 'r2-primary';
    source.storageName = 'Primary R2';
    assert.deepStrictEqual(item.target, TARGET);
    item.storageId = 'r2-primary';
    const body = transportModule.buildDirectUploadBody(item);
    assert.strictEqual(body.get('storageId'), 'r2-archive');
    assert.strictEqual(item.target.storageName, 'Archive R2');
    assert.strictEqual(Object.isFrozen(item.target), true);
  });

  it('adds the exact profile ID to ordinary upload form data', function () {
    const file = new File(['abc'], 'photo.png', { type: 'image/png' });
    const body = transportModule.buildDirectUploadBody({ file, target: TARGET });
    assert.strictEqual(body.get('storageMode'), 'r2');
    assert.strictEqual(body.get('storageId'), 'r2-archive');
    assert.strictEqual(body.get('folderPath'), 'photos/2026');
  });

  it('adds the exact profile ID to URL and multipart initialization payloads', function () {
    assert.deepStrictEqual(transportModule.buildUrlUploadPayload({
      url: 'https://example.test/photo.png', target: TARGET,
    }), {
      url: 'https://example.test/photo.png', storageMode: 'r2',
      storageId: 'r2-archive', folderPath: 'photos/2026',
    });
    assert.deepStrictEqual(transportModule.buildMultipartInitPayload({
      item: {
        file: { name: 'photo.png', size: 3, type: 'image/png' }, target: TARGET,
      },
      totalChunks: 1,
      rootDigest: 'a'.repeat(64),
    }), {
      fileName: 'photo.png', fileSize: 3, fileType: 'image/png', totalChunks: 1,
      rootDigest: 'a'.repeat(64), storageMode: 'r2', storageId: 'r2-archive',
      folderPath: 'photos/2026',
    });
  });
});
