const assert = require('node:assert');

const TARGET = Object.freeze({
  storageMode: 'r2',
  storageId: 'r2-archive',
  storageName: 'Archive R2',
  targetFolderPath: 'photos/2026',
});

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail('queue state did not settle');
}

function queueOptions(transport) {
  return {
    queue: { value: [] }, results: { value: [] }, uploading: { value: false },
    error: { value: '' }, profiles: { value: [{ id: 'r2-archive', type: 'r2', enabled: true }] },
    status: { value: {} }, apiFetch: async () => ({}), transport,
    prepareQueuedImage: async () => {}, getUploadLimit: () => ({}),
    formatSize: String, t: (key) => key, chunkSize: 5,
    humanizeError: String, createId: () => 'queue-control',
  };
}

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
    assert.strictEqual(body.get('uploadSource'), 'image-host');
  });

  it('adds the exact profile ID to URL and multipart initialization payloads', function () {
    assert.deepStrictEqual(transportModule.buildUrlUploadPayload({
      url: 'https://example.test/photo.png', target: TARGET,
    }), {
      url: 'https://example.test/photo.png', storageMode: 'r2',
      storageId: 'r2-archive', folderPath: 'photos/2026',
      uploadSource: 'image-host',
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
      folderPath: 'photos/2026', uploadSource: 'image-host',
    });
  });

  it('marks Drive ordinary, URL, and multipart uploads as Drive writes', function () {
    const target = { ...TARGET, uploadSource: 'drive' };
    const file = new File(['abc'], 'drive.png', { type: 'image/png' });
    assert.strictEqual(
      transportModule.buildDirectUploadBody({ file, target }).get('uploadSource'),
      'drive',
    );
    assert.strictEqual(transportModule.buildUrlUploadPayload({
      url: 'https://example.test/drive.png', target,
    }).uploadSource, 'drive');
    assert.strictEqual(transportModule.buildMultipartInitPayload({
      item: { file, target }, totalChunks: 1, rootDigest: 'b'.repeat(64),
    }).uploadSource, 'drive');
  });

  it('retries failed uploads and cancels active Drive uploads', async function () {
    let attempts = 0;
    const retryOptions = queueOptions({
      directUpload: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('first failure');
        return '/file/retried';
      },
      chunkUpload: async () => '/file/chunked',
    });
    const retryController = queueModule.useUploadQueue(retryOptions);
    retryController.enqueue([{ name: 'retry.txt', size: 1 }], TARGET, {});
    await waitFor(() => retryOptions.queue.value[0]?.status === 'error');
    retryController.retry('queue-control');
    await waitFor(() => retryOptions.queue.value[0]?.status === 'success');
    assert.strictEqual(attempts, 2);

    const cancelOptions = queueOptions({
      directUpload: (item) => new Promise((_resolve, reject) => {
        item.xhr = { abort: () => reject(new Error('UPLOAD_CANCELLED')) };
      }),
      chunkUpload: async () => '/file/chunked',
    });
    const cancelController = queueModule.useUploadQueue(cancelOptions);
    cancelController.enqueue([{ name: 'cancel.txt', size: 1 }], TARGET, {});
    await waitFor(() => cancelOptions.queue.value[0]?.status === 'uploading');
    await cancelController.cancel('queue-control');
    await waitFor(() => cancelOptions.queue.value[0]?.status === 'cancelled');
  });
});
