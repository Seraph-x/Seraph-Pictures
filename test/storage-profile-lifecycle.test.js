const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { initDatabase, get } = require('../server/db');
const { StorageConfigRepository } = require('../server/lib/repos/storage-config-repo');
const { VisibilityFileRepository } = require('../server/lib/repos/visibility-file-repo');

const APP_CONFIG = Object.freeze({ configEncryptionKey: 'lifecycle-test-key' });

function dockerFixture(adapterFactory) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seraph-lifecycle-'));
  const db = initDatabase(path.join(root, 'lifecycle.db'));
  const storageRepo = new StorageConfigRepository(db, APP_CONFIG);
  const fileRepo = new VisibilityFileRepository(db);
  const source = storageRepo.create({
    name: 'Source', type: 'telegram',
    config: { botToken: 'source-token', chatId: 'source-chat' },
  });
  const destination = storageRepo.create({
    name: 'Destination', type: 'telegram',
    config: { botToken: 'destination-token', chatId: 'destination-chat' },
  });
  fileRepo.create({
    id: 'file-1', storageConfigId: source.id, storageType: source.type,
    storageKey: 'source-key', fileName: 'photo.jpg', fileSize: 4,
    mimeType: 'image/jpeg', visibility: 'private', uploadSource: 'drive', accessVersion: 1,
    extra: { telegramFileId: 'source-key' },
  });
  const { StorageLifecycleService } = require('../server/lib/services/storage-lifecycle-service');
  const service = new StorageLifecycleService({
    db, storageRepo, fileRepo,
    storageFactory: { createAdapter: adapterFactory },
  });
  return { db, destination, fileRepo, root, service, source, storageRepo };
}

function closeDockerFixture(fixture) {
  fixture.db.close();
  fs.rmSync(fixture.root, { recursive: true });
}

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

describe('Docker profile lifecycle service', function () {
  it('retains file metadata and an explicit reconciliation row after ambiguous delete', async function () {
    const operationIds = [];
    let confirmed = false;
    const fixture = dockerFixture(() => ({
      delete: async (input) => {
        operationIds.push(input.operationId);
        return confirmed;
      },
    }));
    try {
      await assert.rejects(fixture.service.deleteFile('file-1'), {
        code: 'STORAGE_RECONCILIATION_REQUIRED',
      });
      const pending = get(fixture.db, 'SELECT * FROM storage_file_lifecycle WHERE file_id = ?', ['file-1']);
      assert.strictEqual(pending.state, 'reconciliation');
      assert.strictEqual(pending.source_storage_config_id, fixture.source.id);
      assert.ok(fixture.fileRepo.getById('file-1'));

      confirmed = true;
      const result = await fixture.service.deleteFile('file-1');
      assert.deepStrictEqual(result, { deleted: true, operationId: 'delete:file-1' });
      assert.deepStrictEqual(operationIds, ['delete:file-1', 'delete:file-1']);
      assert.strictEqual(fixture.fileRepo.getById('file-1'), null);
      assert.strictEqual(
        get(fixture.db, 'SELECT operation_id FROM storage_file_lifecycle WHERE file_id = ?', ['file-1']),
        undefined,
      );
    } finally {
      closeDockerFixture(fixture);
    }
  });

  it('checks the migration lock before the first delete backend call', async function () {
    let backendCalls = 0;
    const fixture = dockerFixture(() => ({
      delete: async () => { backendCalls += 1; return true; },
    }));
    try {
      fixture.storageRepo.acquireMigrationLock({ owner: 'migration', token: 'token-1' });
      await assert.rejects(fixture.service.deleteFile('file-1'), {
        code: 'STORAGE_MIGRATION_FAILED',
      });
      assert.strictEqual(backendCalls, 0);
      assert.ok(fixture.fileRepo.getById('file-1'));
    } finally {
      closeDockerFixture(fixture);
    }
  });

  it('protects both profiles and resumes a transfer with one stable operation ID', async function () {
    const events = [];
    let sourceDeleteConfirmed = false;
    const fixture = dockerFixture((profile) => {
      if (profile.id === fixture?.source?.id) {
        return {
          download: async () => {
            events.push('source-download');
            return new Response(new Uint8Array([1, 2, 3, 4]));
          },
          delete: async (input) => {
            events.push(['source-delete', input.operationId]);
            return sourceDeleteConfirmed;
          },
        };
      }
      return {
        upload: async (input) => {
          events.push(['destination-upload', input.operationId]);
          return { storageKey: 'destination-key', metadata: { telegramFileId: 'destination-key' } };
        },
      };
    });
    try {
      await assert.rejects(fixture.service.migrateFile('file-1', fixture.destination.id), {
        code: 'STORAGE_RECONCILIATION_REQUIRED',
      });
      const pending = get(fixture.db, 'SELECT * FROM storage_file_lifecycle WHERE file_id = ?', ['file-1']);
      assert.strictEqual(pending.operation_id, `transfer:file-1:${fixture.destination.id}`);
      assert.strictEqual(pending.source_storage_config_id, fixture.source.id);
      assert.strictEqual(pending.destination_storage_config_id, fixture.destination.id);
      assert.strictEqual(pending.state, 'reconciliation');
      assert.strictEqual(fixture.fileRepo.getById('file-1').storage_config_id, fixture.source.id);

      sourceDeleteConfirmed = true;
      const result = await fixture.service.migrateFile('file-1', fixture.destination.id);
      assert.deepStrictEqual(result, {
        migrated: true,
        operationId: `transfer:file-1:${fixture.destination.id}`,
        storageId: fixture.destination.id,
      });
      assert.deepStrictEqual(events, [
        'source-download',
        ['destination-upload', `transfer:file-1:${fixture.destination.id}`],
        ['source-delete', `transfer:file-1:${fixture.destination.id}`],
        ['source-delete', `transfer:file-1:${fixture.destination.id}`],
      ]);
      const moved = fixture.fileRepo.getById('file-1');
      assert.strictEqual(moved.storage_config_id, fixture.destination.id);
      assert.strictEqual(moved.storage_key, 'destination-key');
      assert.strictEqual(moved.metadata.telegramFileId, 'destination-key');
      assert.strictEqual(
        get(fixture.db, 'SELECT operation_id FROM storage_file_lifecycle WHERE file_id = ?', ['file-1']),
        undefined,
      );
      assert.deepStrictEqual(
        await fixture.service.migrateFile('file-1', fixture.destination.id),
        result,
      );
      assert.strictEqual(events.length, 4);
    } finally {
      closeDockerFixture(fixture);
    }
  });

  it('does not repeat an ambiguous destination write without reconciliation evidence', async function () {
    let destinationWrites = 0;
    const fixture = dockerFixture((profile) => {
      if (profile.id === fixture?.source?.id) {
        return { download: async () => new Response(new Uint8Array([1, 2, 3, 4])) };
      }
      return {
        upload: async () => {
          destinationWrites += 1;
          throw new Error('destination timeout');
        },
      };
    });
    try {
      await assert.rejects(fixture.service.migrateFile('file-1', fixture.destination.id), {
        code: 'STORAGE_RECONCILIATION_REQUIRED',
      });
      await assert.rejects(fixture.service.migrateFile('file-1', fixture.destination.id), {
        code: 'STORAGE_RECONCILIATION_REQUIRED',
      });
      assert.strictEqual(destinationWrites, 1);
      assert.strictEqual(fixture.fileRepo.getById('file-1').storage_config_id, fixture.source.id);
    } finally {
      closeDockerFixture(fixture);
    }
  });

  it('does not clean the source when destination metadata is incomplete', async function () {
    let sourceDeletes = 0;
    const fixture = dockerFixture((profile) => {
      if (profile.id === fixture?.source?.id) {
        return {
          download: async () => new Response(new Uint8Array([1, 2, 3, 4])),
          delete: async () => { sourceDeletes += 1; return true; },
        };
      }
      return { upload: async () => ({ metadata: { telegramFileId: 'missing-key' } }) };
    });
    try {
      await assert.rejects(fixture.service.migrateFile('file-1', fixture.destination.id), {
        code: 'STORAGE_RECONCILIATION_REQUIRED',
      });
      assert.strictEqual(sourceDeletes, 0);
      assert.strictEqual(fixture.fileRepo.getById('file-1').storage_config_id, fixture.source.id);
    } finally {
      closeDockerFixture(fixture);
    }
  });
});
