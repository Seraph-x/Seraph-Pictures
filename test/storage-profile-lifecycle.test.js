const assert = require('node:assert');

describe('Cloudflare profile-aware delete operation', function () {
  it('keeps the profile protected until backend and metadata cleanup finish', async function () {
    const { executeStorageDelete } = await import(
      '../functions/services/storage-runtime/delete-operation.js'
    );
    const events = [];
    const result = await executeStorageDelete({
      record: {
        fileId: 'r2:file-1',
        metadata: {
          storageConfigId: 'r2-a', storageType: 'r2', storageOperationId: 'upload-1',
        },
      },
      resolver: { resolve: async (input) => { events.push(['resolve', input]); return { id: 'r2-a' }; } },
      adapterFactory: () => ({ profileId: 'r2-a' }),
      references: {
        releaseStart: async () => { events.push('release-start'); },
        releaseFinish: async () => { events.push('release-finish'); },
      },
      backend: { remove: async () => { events.push('backend-delete'); } },
      metadata: { remove: async () => { events.push('metadata-delete'); return { deleted: true }; } },
    });
    assert.deepStrictEqual(result, { deleted: true });
    assert.deepStrictEqual(events.map((event) => Array.isArray(event) ? event[0] : event), [
      'resolve', 'release-start', 'backend-delete', 'metadata-delete', 'release-finish',
    ]);
    assert.deepStrictEqual(events[0][1], {
      storageId: 'r2-a', storageMode: 'r2', forWrite: false,
      persisted: true, legacy: false,
    });
  });

  it('keeps a releasing reference when backend cleanup fails', async function () {
    const { executeStorageDelete } = await import(
      '../functions/services/storage-runtime/delete-operation.js'
    );
    const events = [];
    await assert.rejects(executeStorageDelete({
      record: {
        fileId: 'legacy-file',
        metadata: { storageType: 'telegram' },
      },
      resolver: { resolve: async () => ({ id: 'tg-a' }) },
      adapterFactory: () => ({}),
      references: {
        releaseStart: async (input) => { events.push(['release-start', input]); },
        releaseFinish: async () => { events.push('release-finish'); },
      },
      backend: { remove: async () => { throw new Error('delete timeout'); } },
      metadata: { remove: async () => { events.push('metadata-delete'); } },
    }), /delete timeout/);
    assert.deepStrictEqual(events.map((event) => event[0] || event), ['release-start']);
    assert.strictEqual(events[0][1].operationId, 'migration:legacy-file');
  });
});

describe('Cloudflare cross-profile transfer operation', function () {
  it('protects both profiles until metadata and source cleanup are committed', async function () {
    const { executeStorageTransfer } = await import(
      '../functions/services/storage-runtime/transfer-operation.js'
    );
    const events = [];
    const result = await executeStorageTransfer({
      record: {
        fileId: 'file-1',
        metadata: {
          storageConfigId: 'r2-a', storageType: 'r2', storageOperationId: 'upload-1',
        },
      },
      destination: { storageId: 'r2-b', storageMode: 'r2' },
      resolver: { resolve: async (input) => ({
        id: input.storageId, type: 'r2', generation: 'generation-2',
      }) },
      adapterFactory: ({ profile }) => ({ profileId: profile.id }),
      references: {
        transferStart: async () => { events.push('transfer-start'); },
        transferFinish: async () => { events.push('transfer-finish'); },
      },
      backend: {
        copy: async () => { events.push('destination-write'); return { key: 'new-key' }; },
        remove: async () => { events.push('source-delete'); },
      },
      metadata: {
        replace: async (input) => { events.push(['metadata', input]); return { moved: true }; },
      },
    });
    assert.deepStrictEqual(result, { moved: true });
    assert.deepStrictEqual(events.map((event) => Array.isArray(event) ? event[0] : event), [
      'transfer-start', 'destination-write', 'metadata', 'source-delete', 'transfer-finish',
    ]);
    assert.strictEqual(events[2][1].storageConfigId, 'r2-b');
  });
});
