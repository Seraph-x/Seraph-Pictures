const assert = require('node:assert');

describe('Cloudflare profile-bound write operation', function () {
  it('reserves and enters committing before backend IO, then publishes metadata', async function () {
    const { executeStorageWrite } = await import(
      '../functions/services/storage-runtime/write-operation.js'
    );
    const events = [];
    const profile = { id: 'tg-a', type: 'telegram', generation: 'g1', enabled: true };
    const result = await executeStorageWrite({
      selection: { storageId: 'tg-a', storageMode: 'telegram' },
      operation: { operationId: 'upload-1', expiresAt: 9_000 },
      payload: { fileName: 'a.png' },
      resolver: { resolve: async (input) => { events.push(['resolve', input]); return profile; } },
      adapterFactory: () => ({ profileId: 'tg-a' }),
      references: {
        reserve: async () => { events.push('reserve'); },
        commitStart: async () => { events.push('commit-start'); },
        commitFinish: async () => { events.push('commit-finish'); },
      },
      backend: { write: async () => { events.push('backend-write'); return { key: 'object-1' }; } },
      metadata: { create: async (input) => { events.push(['metadata', input]); return { id: 'file-1' }; } },
    });

    assert.deepStrictEqual(result, { id: 'file-1' });
    assert.deepStrictEqual(events.map((event) => Array.isArray(event) ? event[0] : event), [
      'resolve', 'reserve', 'commit-start', 'backend-write', 'metadata', 'commit-finish',
    ]);
    assert.deepStrictEqual(events[0][1], {
      storageId: 'tg-a', storageMode: 'telegram', forWrite: true,
    });
    assert.strictEqual(events[4][1].storageConfigId, 'tg-a');
    assert.strictEqual(events[4][1].storageGeneration, 'g1');
  });

  it('keeps an ambiguous backend failure protected in committing state', async function () {
    const { executeStorageWrite } = await import(
      '../functions/services/storage-runtime/write-operation.js'
    );
    const events = [];
    await assert.rejects(executeStorageWrite({
      selection: { storageId: 'r2-a', storageMode: 'r2' },
      operation: { operationId: 'upload-2', expiresAt: 9_000 },
      payload: {},
      resolver: { resolve: async () => ({ id: 'r2-a', type: 'r2', generation: 'g1' }) },
      adapterFactory: () => ({}),
      references: {
        reserve: async () => { events.push('reserve'); },
        commitStart: async () => { events.push('commit-start'); },
        commitFinish: async () => { events.push('commit-finish'); },
      },
      backend: { write: async () => { events.push('backend-write'); throw new Error('timeout'); } },
      metadata: { create: async () => { events.push('metadata'); } },
    }), /timeout/);
    assert.deepStrictEqual(events, ['reserve', 'commit-start', 'backend-write']);
  });

  it('defers R2 metadata until the write coordinator publishes it', async function () {
    const { uploadToR2 } = await import('../functions/services/direct-upload-backends.js');
    const objects = [];
    const records = [];
    const profile = { id: 'r2-a', type: 'r2', generation: 'g1' };
    const artifact = await uploadToR2({
      file: new Blob(['image'], { type: 'image/png' }),
      fileName: 'a.png', extension: 'png', profile, deferMetadata: true,
      env: {
        R2_BUCKET: { put: async (key) => { objects.push(key); } },
        img_url: { put: async (key, _value, options) => { records.push([key, options.metadata]); } },
      },
    });

    assert.strictEqual(objects.length, 1);
    assert.strictEqual(records.length, 0);
    const response = await artifact.persist();
    assert.strictEqual(response.status, 200);
    assert.strictEqual(records[0][1].storageConfigId, 'r2-a');
    assert.strictEqual(records[0][1].storageGeneration, 'g1');
  });
});

describe('First-party upload selection', function () {
  it('requires both storage mode and profile ID for browser administrators', async function () {
    const { normalizeUploadSelection } = await import('../functions/services/upload-selection.js');
    assert.throws(() => normalizeUploadSelection({
      isAdmin: true, isApi: false, storageMode: 'telegram', storageId: '',
    }), { code: 'STORAGE_SELECTION_REQUIRED' });
    assert.deepStrictEqual(normalizeUploadSelection({
      isAdmin: true, isApi: false, storageMode: 'telegram', storageId: 'tg-a',
    }), { storageMode: 'telegram', storageId: 'tg-a' });
  });

  it('allows authenticated API callers to select only a type', async function () {
    const { normalizeUploadSelection } = await import('../functions/services/upload-selection.js');
    assert.deepStrictEqual(normalizeUploadSelection({
      isAdmin: true, isApi: true, storageMode: 'r2', storageId: '',
    }), { storageMode: 'r2', storageId: '' });
  });

  it('applies the same exact-selection rule to Docker administrators', function () {
    const { normalizeDockerUploadSelection } = require(
      '../server/lib/services/upload-request'
    );
    assert.throws(() => normalizeDockerUploadSelection({
      authenticated: true, storageMode: 'webdav', storageId: '',
    }), { code: 'STORAGE_SELECTION_REQUIRED' });
    assert.deepStrictEqual(normalizeDockerUploadSelection({
      authenticated: true, storageMode: 'webdav', storageId: 'webdav-a',
    }), { storageMode: 'webdav', storageId: 'webdav-a' });
  });
});

describe('API v1 storage selection forwarding', function () {
  it('forwards an exact storage type and profile ID', async function () {
    const { readOptions, buildUploadRequest } = await import('../functions/api/v1/upload.js');
    const form = new FormData();
    form.set('file', new Blob(['a'], { type: 'image/png' }), 'a.png');
    form.set('storage', 'telegram');
    form.set('storage_id', 'tg-a');
    const request = new Request('https://example.com/api/v1/upload', { method: 'POST' });
    const options = readOptions(form, new URL(request.url));
    const forwarded = await buildUploadRequest(request, form, options).formData();

    assert.strictEqual(options.storageId, 'tg-a');
    assert.strictEqual(forwarded.get('storageMode'), 'telegram');
    assert.strictEqual(forwarded.get('storageId'), 'tg-a');
  });

  it('keeps type-only API requests backward compatible', async function () {
    const { readOptions, buildUploadRequest } = await import('../functions/api/v1/upload.js');
    const form = new FormData();
    form.set('file', new Blob(['a'], { type: 'image/png' }), 'a.png');
    form.set('storage', 'r2');
    const request = new Request('https://example.com/api/v1/upload', { method: 'POST' });
    const options = readOptions(form, new URL(request.url));
    const forwarded = await buildUploadRequest(request, form, options).formData();

    assert.strictEqual(options.storageId, '');
    assert.strictEqual(forwarded.get('storageMode'), 'r2');
    assert.strictEqual(forwarded.has('storageId'), false);
  });
});

describe('Docker profile-bound write operation', function () {
  it('persists the reservation before adapter IO and commits metadata before release', async function () {
    const { UploadService } = require('../server/lib/services/upload-service');
    const events = [];
    const storage = { id: 'webdav-a', name: 'WebDAV A', type: 'webdav' };
    const service = new UploadService({
      storageRepo: {
        resolveStorageSelection: () => storage,
        reserveReference: (input) => { events.push(`reference:${input.state}`); },
        commitReference: (_operationId, operation) => {
          const value = operation();
          events.push('reference:released');
          return value;
        },
      },
      fileRepo: { create: (input) => { events.push('metadata'); return input; } },
      storageFactory: { createAdapter: () => ({
        upload: async () => { events.push('backend-write'); return { storageKey: 'key-1' }; },
      }) },
    });

    const result = await service.uploadFile({
      fileName: 'a.png', mimeType: 'image/png', fileSize: 3,
      buffer: new Uint8Array([1, 2, 3]), storageId: 'webdav-a', storageMode: 'webdav',
    });

    assert.strictEqual(result.file.storageConfigId, 'webdav-a');
    assert.deepStrictEqual(events, [
      'reference:reserved', 'reference:committing', 'backend-write',
      'metadata', 'reference:released',
    ]);
  });

  it('releases a failed write only after backend cleanup is confirmed', async function () {
    const { executeStorageWrite } = require('../server/lib/services/storage-write-operation');
    const events = [];
    await assert.rejects(executeStorageWrite({
      storageRepo: {
        reserveReference: ({ state }) => events.push(state),
        releaseReference: () => events.push('released'),
      },
      fileRepo: { create: () => events.push('metadata') },
      adapter: {
        upload: async () => { events.push('upload'); throw new Error('upload failed'); },
        delete: async () => { events.push('cleanup'); },
      },
      storageConfig: { id: 'webdav-a' },
      operationId: 'upload-3',
      uploadInput: { storageKey: 'key-3' },
      buildFileRecord: () => ({}),
    }), /upload failed/);
    assert.deepStrictEqual(events, [
      'reserved', 'committing', 'upload', 'cleanup', 'released',
    ]);
  });

  it('keeps the committing reference when backend cleanup is ambiguous', async function () {
    const { executeStorageWrite } = require('../server/lib/services/storage-write-operation');
    const storageRepo = {
      reserveReference() {},
      releaseReference: () => assert.fail('ambiguous reference must remain'),
    };
    await assert.rejects(executeStorageWrite({
      storageRepo,
      fileRepo: { create: () => ({}) },
      adapter: {
        upload: async () => { throw new Error('upload failed'); },
        delete: async () => { throw new Error('cleanup failed'); },
      },
      storageConfig: { id: 'webdav-a' },
      operationId: 'upload-4',
      uploadInput: { storageKey: 'key-4' },
      buildFileRecord: () => ({}),
    }), { code: 'STORAGE_WRITE_RECONCILIATION_REQUIRED' });
  });
});
