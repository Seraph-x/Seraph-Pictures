const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { initDatabase, run } = require('../server/db');

const PROFILE = Object.freeze({
  id: 'r2-a', type: 'r2', generation: 'generation-1',
});

describe('Cloudflare multipart storage profile snapshot', function () {
  it('requires an exact profile snapshot in the immutable multipart plan', async function () {
    const { validateMultipartPlan } = await import(
      '../workers/coordinator/src/upload/multipart-plan.js'
    );
    const input = {
      uploadId: 'upload-1', owner: 'admin', visibility: 'private', expectedSize: 3,
      partSize: 5 * 1024 * 1024, totalParts: 1, rootDigest: 'a'.repeat(64),
      fileName: 'a.png', fileType: 'image/png', folderPath: '',
      createdAt: 1, expiresAt: 10,
    };
    assert.throws(() => validateMultipartPlan(input), /MULTIPART_PLAN_INVALID/);
    const plan = validateMultipartPlan({
      ...input,
      storageConfigId: PROFILE.id,
      storageType: PROFILE.type,
      storageGeneration: PROFILE.generation,
    });
    assert.strictEqual(plan.storageConfigId, 'r2-a');
    assert.strictEqual(plan.storageGeneration, 'generation-1');
  });

  it('enters committing before the first R2 mutation and publishes the snapshot', async function () {
    const { UploadCoordinatorService } = await import(
      '../workers/coordinator/src/upload/upload-coordinator.js'
    );
    const events = [];
    let record;
    const service = new UploadCoordinatorService({
      repository: { read: async () => record, write: async (next) => { record = next; } },
      r2: {
        createMultipartUpload: async () => { events.push('r2-create'); return { uploadId: 'r2-1' }; },
        resumeMultipartUpload: () => ({ abort: async () => { events.push('r2-abort'); } }),
        head: async () => null,
        delete: async () => {},
      },
      quota: { reserve: async () => {}, consume: async () => {}, cancel: async () => {} },
      metadata: { publish: async () => {} },
      references: {
        reserve: async () => { events.push('reference-reserved'); },
        commitStart: async () => { events.push('reference-committing'); },
        commitFinish: async () => {},
        releaseStart: async () => { events.push('reference-releasing'); },
        releaseFinish: async () => { events.push('reference-released'); },
      },
      alarms: { schedule: async () => {} },
    });
    const result = await service.initialize({
      uploadId: 'upload-1', owner: 'admin', visibility: 'private', expectedSize: 3,
      partSize: 5 * 1024 * 1024, totalParts: 1, rootDigest: 'a'.repeat(64),
      fileName: 'a.png', fileType: 'image/png', folderPath: '', createdAt: 1,
      expiresAt: 10, storageConfigId: PROFILE.id, storageType: PROFILE.type,
      storageGeneration: PROFILE.generation,
    });
    assert.deepStrictEqual(events, [
      'reference-reserved', 'reference-committing', 'r2-create',
    ]);
    assert.strictEqual(result.storageConfigId, 'r2-a');
    await service.cancel({ uploadId: 'upload-1' });
    assert.deepStrictEqual(events.slice(-3), [
      'reference-releasing', 'r2-abort', 'reference-released',
    ]);
  });
});

describe('Docker multipart storage profile snapshot', function () {
  it('resolves and persists the exact profile before accepting chunks', function () {
    const { ChunkUploadService } = require('../server/lib/services/chunk-service');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seraph-profile-chunks-'));
    const db = initDatabase(path.join(root, 'test.db'));
    run(db, `INSERT INTO storage_configs(
      id, name, type, encrypted_payload, is_default, enabled,
      metadata_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
      'r2-a', 'R2 A', 'r2', '{}', 1, 1, '{}', 1, 1,
    ]);
    const events = [];
    const uploadService = {
      resolveStorage: () => ({ id: 'r2-a', type: 'r2' }),
      uploadFile: async () => ({}),
    };
    const storageRepo = {
      createChunkReference: (operation) => { events.push('reference'); return operation(); },
    };
    const service = new ChunkUploadService({
      db, storageRepo, uploadService,
      config: { chunkDir: path.join(root, 'chunks'), chunkSize: 5 },
    });
    try {
      const task = service.initTask({
        fileName: 'a.bin', fileSize: 5, fileType: 'application/octet-stream',
        totalChunks: 1, storageMode: 'r2', storageId: 'r2-a',
      });
      const persisted = service.getTask(task.uploadId);
      assert.deepStrictEqual(events, ['reference']);
      assert.strictEqual(persisted.storage_config_id, 'r2-a');
      assert.strictEqual(persisted.storage_mode, 'r2');
    } finally {
      db.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps a committing task protected after its lease expires', function () {
    const { ChunkUploadService } = require('../server/lib/services/chunk-service');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seraph-committing-chunks-'));
    const db = initDatabase(path.join(root, 'test.db'));
    run(db, `INSERT INTO storage_configs(
      id, name, type, encrypted_payload, is_default, enabled,
      metadata_json, created_at, updated_at
    ) VALUES ('r2-a', 'R2 A', 'r2', '{}', 1, 1, '{}', 1, 1)`);
    const service = new ChunkUploadService({
      db,
      storageRepo: { createChunkReference: (operation) => operation() },
      uploadService: {
        resolveStorage: () => ({ id: 'r2-a', type: 'r2' }),
        uploadFile: async () => ({}),
      },
      config: { chunkDir: path.join(root, 'chunks'), chunkSize: 5 },
    });
    try {
      const { uploadId } = service.initTask({
        fileName: 'a.bin', fileSize: 5, totalChunks: 1,
        storageMode: 'r2', storageId: 'r2-a',
      });
      run(db, `UPDATE chunk_uploads SET write_state = 'committing', expires_at = 1
        WHERE upload_id = ?`, [uploadId]);
      assert.strictEqual(service.getTask(uploadId).storage_config_id, 'r2-a');
    } finally {
      db.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
