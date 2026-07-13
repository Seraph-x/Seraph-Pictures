const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const {
  createAccessMetadata,
  updateVisibility,
  resolveStoredAccessMetadata,
} = require('../shared/security/file-metadata.cjs');

describe('explicit file visibility metadata', function () {
  it('uses source-specific immutable defaults', function () {
    assert.deepStrictEqual(createAccessMetadata({ uploadSource: 'guest' }), {
      visibility: 'public', uploadSource: 'guest', accessVersion: 1,
    });
    assert.deepStrictEqual(createAccessMetadata({ uploadSource: 'image-host' }), {
      visibility: 'public', uploadSource: 'image-host', accessVersion: 1,
    });
    assert.deepStrictEqual(createAccessMetadata({ uploadSource: 'drive' }), {
      visibility: 'private', uploadSource: 'drive', accessVersion: 1,
    });
    assert.deepStrictEqual(createAccessMetadata({ uploadSource: 'api' }), {
      visibility: 'public', uploadSource: 'api', accessVersion: 1,
    });
  });

  it('accepts only explicit public/private API visibility', function () {
    assert.deepStrictEqual(
      createAccessMetadata({ uploadSource: 'api', requestedVisibility: 'private' }),
      { visibility: 'private', uploadSource: 'api', accessVersion: 1 },
    );
    assert.throws(
      () => createAccessMetadata({ uploadSource: 'api', requestedVisibility: 'hidden' }),
      (error) => error?.code === 'FILE_VISIBILITY_INVALID',
    );
  });

  it('allows legacy public only before the authoritative migration marker', function () {
    assert.deepStrictEqual(
      resolveStoredAccessMetadata({ metadata: {}, migrationComplete: false }),
      { visibility: 'public', uploadSource: 'legacy', accessVersion: 1 },
    );
    assert.throws(
      () => resolveStoredAccessMetadata({ metadata: {}, migrationComplete: true }),
      (error) => error?.code === 'FILE_VISIBILITY_INVALID',
    );
  });

  it('requires an administrator and increments accessVersion on changes', function () {
    const current = Object.freeze({
      visibility: 'private', uploadSource: 'drive', accessVersion: 4,
    });
    assert.throws(
      () => updateVisibility({ metadata: current, visibility: 'public', actor: 'anonymous' }),
      (error) => error?.code === 'FILE_ACCESS_DENIED',
    );
    assert.deepStrictEqual(
      updateVisibility({ metadata: current, visibility: 'public', actor: 'admin' }),
      { visibility: 'public', uploadSource: 'drive', accessVersion: 5 },
    );
    assert.strictEqual(current.visibility, 'private');
  });

  it('requires explicit ownership transfer before making a guest file private', function () {
    const current = Object.freeze({
      visibility: 'public', uploadSource: 'guest', accessVersion: 1,
    });
    assert.throws(
      () => updateVisibility({ metadata: current, visibility: 'private', actor: 'admin' }),
      (error) => error?.code === 'FILE_OWNERSHIP_TRANSFER_REQUIRED',
    );
    assert.deepStrictEqual(
      updateVisibility({
        metadata: current,
        visibility: 'private',
        actor: 'admin',
        ownershipTransferred: true,
      }),
      {
        visibility: 'private',
        uploadSource: 'guest',
        accessVersion: 2,
        owner: 'admin',
      },
    );
  });

  it('defines explicit Docker persistence columns', function () {
    const schema = fs.readFileSync(path.resolve(__dirname, '../server/db/schema.sql'), 'utf8');
    assert.match(schema, /visibility TEXT NOT NULL/);
    assert.match(schema, /upload_source TEXT NOT NULL/);
    assert.match(schema, /access_version INTEGER NOT NULL/);
    assert.match(schema, /expires_at INTEGER/);
  });

  it('persists and increments Docker visibility metadata', function () {
    const schema = fs.readFileSync(path.resolve(__dirname, '../server/db/schema.sql'), 'utf8');
    const { VisibilityFileRepository } = require('../server/lib/repos/visibility-file-repo');
    const db = new DatabaseSync(':memory:');
    db.exec(schema);
    db.prepare(
      `INSERT INTO storage_configs
       (id, name, type, encrypted_payload, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('storage-1', 'Storage', 'r2', '{}', 1, 1);
    const repository = new VisibilityFileRepository(db);
    repository.create({
      id: 'file-1',
      storageConfigId: 'storage-1',
      storageType: 'r2',
      storageKey: 'file-1',
      fileName: 'file.png',
      visibility: 'private',
      uploadSource: 'drive',
      accessVersion: 1,
    });

    const updated = repository.updateVisibility('file-1', {
      visibility: 'public', actor: 'admin',
    });

    assert.strictEqual(updated.metadata.visibility, 'public');
    assert.strictEqual(updated.metadata.uploadSource, 'drive');
    assert.strictEqual(updated.metadata.accessVersion, 2);
    db.close();
  });

  it('persists explicit access metadata through Docker uploads', async function () {
    const { UploadService } = require('../server/lib/services/upload-service');
    let created;
    const service = new UploadService({
      storageRepo: {
        resolveStorageSelection() { return { id: 'storage-1', type: 'r2' }; },
      },
      fileRepo: {
        create(file) { created = file; return file; },
      },
      storageFactory: {
        createAdapter() {
          return { async upload({ storageKey }) { return { storageKey, metadata: {} }; } };
        },
      },
    });

    await service.uploadFile({
      fileName: 'guest.png',
      mimeType: 'image/png',
      fileSize: 4,
      buffer: new Uint8Array([1, 2, 3, 4]),
      uploadSource: 'guest',
      visibility: 'public',
      expiresAt: 1_800_000_000_000,
      retentionDays: 3,
    });

    assert.strictEqual(created.visibility, 'public');
    assert.strictEqual(created.uploadSource, 'guest');
    assert.strictEqual(created.accessVersion, 1);
    assert.strictEqual(created.expiresAt, 1_800_000_000_000);
    assert.strictEqual(created.extra.retentionDays, 3);
  });

});
