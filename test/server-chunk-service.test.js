const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { initDatabase } = require('../server/db');
const { ChunkUploadService } = require('../server/lib/services/chunk-service');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function createFixture(uploadFile = async ({ buffer }) => ({ buffer })) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seraph-chunks-'));
  const db = initDatabase(path.join(root, 'test.db'));
  const config = { chunkDir: path.join(root, 'chunks'), chunkSize: 5, uploadMaxSize: 100 };
  const service = new ChunkUploadService({ db, config, uploadService: { uploadFile } });
  return { root, db, service };
}

function initTask(service, overrides = {}) {
  return service.initTask({
    fileName: 'sample.bin',
    fileSize: 11,
    fileType: 'application/octet-stream',
    totalChunks: 3,
    storageMode: 'r2',
    storageId: '',
    folderPath: '',
    ...overrides,
  });
}

function cleanupFixture(fixture) {
  fixture.db.close();
  fs.rmSync(fixture.root, { recursive: true, force: true });
}

describe('Docker ChunkUploadService', function () {
  it('uses UUID task IDs and rejects inconsistent plans', function () {
    const fixture = createFixture();
    try {
      assert.match(initTask(fixture.service).uploadId, UUID_PATTERN);
      assert.throws(
        () => initTask(fixture.service, { totalChunks: 2 }),
        (error) => error?.code === 'CHUNK_PLAN_MISMATCH'
      );
    } finally {
      cleanupFixture(fixture);
    }
  });

  it('rejects invalid indexes and incorrect part sizes before writing', async function () {
    const fixture = createFixture();
    try {
      const { uploadId } = initTask(fixture.service);
      await assert.rejects(
        async () => fixture.service.saveChunk({ uploadId, chunkIndex: 3, buffer: Buffer.alloc(1) }),
        (error) => error?.code === 'INVALID_CHUNK_INDEX'
      );
      await assert.rejects(
        async () => fixture.service.saveChunk({ uploadId, chunkIndex: 0, buffer: Buffer.alloc(4) }),
        (error) => error?.code === 'INVALID_CHUNK_SIZE'
      );
      assert.deepStrictEqual(fs.readdirSync(fixture.service.taskDir(uploadId)), []);
    } finally {
      cleanupFixture(fixture);
    }
  });

  it('merges valid parts into exactly the declared bytes', async function () {
    let uploaded = null;
    const fixture = createFixture(async (input) => {
      uploaded = input;
      return { file: { id: 'id' }, src: '/file/id' };
    });
    try {
      const { uploadId } = initTask(fixture.service);
      await fixture.service.saveChunk({ uploadId, chunkIndex: 0, buffer: Buffer.from('12345') });
      await fixture.service.saveChunk({ uploadId, chunkIndex: 1, buffer: Buffer.from('67890') });
      await fixture.service.saveChunk({ uploadId, chunkIndex: 2, buffer: Buffer.from('x') });
      await fixture.service.complete(uploadId);

      assert.strictEqual(uploaded.buffer.toString(), '1234567890x');
      assert.strictEqual(uploaded.fileSize, 11);
      assert.strictEqual(fs.existsSync(fixture.service.taskDir(uploadId)), false);
    } finally {
      cleanupFixture(fixture);
    }
  });

  it('preserves task files when final storage upload fails', async function () {
    const fixture = createFixture(async () => {
      throw new Error('storage unavailable');
    });
    try {
      const { uploadId } = initTask(fixture.service, { fileSize: 5, totalChunks: 1 });
      await fixture.service.saveChunk({ uploadId, chunkIndex: 0, buffer: Buffer.from('12345') });
      await assert.rejects(fixture.service.complete(uploadId), /storage unavailable/);
      assert.strictEqual(fs.existsSync(fixture.service.chunkPath(uploadId, 0)), true);
      assert.ok(fixture.service.getTask(uploadId));
    } finally {
      cleanupFixture(fixture);
    }
  });
});
