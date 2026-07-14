const assert = require('node:assert');
const { createHash } = require('node:crypto');

const MIB = 1024 * 1024;
const PART_SIZE = 5 * MIB;

class MemoryRepository {
  constructor() { this.record = null; this.writeCount = 0; this.failWriteAt = null; }
  read() { return this.record; }
  write(record) {
    this.writeCount += 1;
    if (this.writeCount === this.failWriteAt) throw new Error('repository unavailable');
    this.record = record;
  }
}

class FakeR2 {
  constructor() {
    this.calls = [];
    this.objects = new Map();
    this.completeFailure = null;
    this.objectMetadataOverride = null;
  }

  async createMultipartUpload(key, options) {
    this.calls.push({ method: 'create', key, options });
    return { uploadId: 'r2-upload-1' };
  }

  resumeMultipartUpload(key, uploadId) {
    return {
      uploadPart: async (partNumber, value) => {
        this.calls.push({ method: 'part', key, uploadId, partNumber, value });
        return { partNumber, etag: `etag-${partNumber}` };
      },
      complete: async (parts) => {
        this.calls.push({ method: 'complete', key, uploadId, parts });
        const state = this.state;
        const object = {
          key, size: state.expectedSize, etag: 'object-etag',
          customMetadata: this.objectMetadataOverride || state.customMetadata,
        };
        this.objects.set(key, object);
        if (this.completeFailure) throw this.completeFailure;
        return object;
      },
      abort: async () => { this.calls.push({ method: 'abort', key, uploadId }); },
    };
  }

  async head(key) {
    this.calls.push({ method: 'head', key });
    return this.objects.get(key) ?? null;
  }

  async delete(key) {
    this.calls.push({ method: 'delete', key });
    this.objects.delete(key);
  }
}

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function baseRequest(overrides = {}) {
  return {
    uploadId: 'upload-1', owner: 'admin', visibility: 'private', uploadSource: 'drive',
    expectedSize: (2 * PART_SIZE) + 3, partSize: PART_SIZE, totalParts: 3,
    rootDigest: 'a'.repeat(64), fileName: 'photo.png', fileType: 'image/png',
    storageConfigId: 'r2-a', storageType: 'r2', storageGeneration: 'generation-1',
    folderPath: '', createdAt: 1_000, expiresAt: 100_000, ...overrides,
  };
}

async function createHarness() {
  const module = await import('../workers/coordinator/src/upload/upload-coordinator.js');
  const repository = new MemoryRepository();
  const r2 = new FakeR2();
  const quotaCalls = [];
  const metadataCalls = [];
  const referenceCalls = [];
  const timeline = [];
  const alarms = [];
  const quota = {
    reserve: async (input) => { timeline.push('quota-reserve'); quotaCalls.push({ method: 'reserve', ...input }); },
    consume: async (input) => { timeline.push('quota-consume'); quotaCalls.push({ method: 'consume', ...input }); },
    cancel: async (input) => { timeline.push('quota-cancel'); quotaCalls.push({ method: 'cancel', ...input }); },
  };
  const metadata = {
    publish: async (input) => { timeline.push('metadata'); metadataCalls.push(input); },
  };
  const references = Object.fromEntries([
    'reserve', 'commitStart', 'commitFinish', 'releaseStart', 'releaseFinish',
  ].map((method) => [method, async (input) => {
    timeline.push(`reference-${method}`);
    referenceCalls.push({ method, ...input });
  }]));
  const service = new module.UploadCoordinatorService({
    repository, r2, quota, metadata, references,
    alarms: { schedule: async (timestamp) => { alarms.push(timestamp); } },
  });
  return {
    service, repository, r2, quotaCalls, metadataCalls, referenceCalls, timeline, alarms,
  };
}

async function initialize(harness, request = baseRequest()) {
  const result = await harness.service.initialize(request);
  harness.r2.state = {
    expectedSize: request.expectedSize,
    customMetadata: result.customMetadata,
  };
  return result;
}

async function uploadAll(harness) {
  const chunks = [Buffer.alloc(PART_SIZE, 1), Buffer.alloc(PART_SIZE, 2), Buffer.alloc(3, 3)];
  for (const [index, bytes] of chunks.entries()) {
    await harness.service.uploadPart({
      uploadId: 'upload-1', partNumber: index + 1, bytes,
      digest: digest(bytes),
    });
  }
  return chunks;
}

describe('R2 multipart coordinator runtime', function () {
  it('validates the plan and fails closed before external side effects', async function () {
    const harness = await createHarness();
    await assert.rejects(
      harness.service.initialize(baseRequest({ partSize: MIB })),
      /MULTIPART_PART_TOO_SMALL/,
    );
    assert.deepStrictEqual(harness.quotaCalls, []);
    assert.deepStrictEqual(harness.r2.calls, []);
    const module = await import('../workers/coordinator/src/upload/upload-coordinator.js');
    await assert.rejects(
      new module.UploadCoordinatorService({}).initialize(baseRequest()),
      /MULTIPART_BINDING_MISSING/,
    );
  });

  it('uploads exact verified parts without reading a whole object', async function () {
    const harness = await createHarness();
    const initialized = await initialize(harness);
    const chunks = await uploadAll(harness);
    const partCalls = harness.r2.calls.filter((call) => call.method === 'part');
    assert.deepStrictEqual(partCalls.map((call) => call.value), chunks);
    assert.strictEqual(initialized.objectKey, 'multipart/upload-1');
    assert.deepStrictEqual(initialized.customMetadata, {
      uploadId: 'upload-1', rootDigest: 'a'.repeat(64), expectedSize: String((2 * PART_SIZE) + 3),
      storageConfigId: 'r2-a', storageGeneration: 'generation-1',
    });
    assert.strictEqual(harness.r2.calls.some((call) => call.method === 'get'), false);
  });

  it('rejects wrong lengths and SHA-256 mismatches before R2 upload', async function () {
    const harness = await createHarness();
    await initialize(harness);
    const short = Buffer.alloc(PART_SIZE - 1);
    await assert.rejects(harness.service.uploadPart({
      uploadId: 'upload-1', partNumber: 1, bytes: short, digest: digest(short),
    }), /MULTIPART_PART_LENGTH_INVALID/);
    const exact = Buffer.alloc(PART_SIZE);
    await assert.rejects(harness.service.uploadPart({
      uploadId: 'upload-1', partNumber: 1, bytes: exact, digest: 'wrong',
    }), /MULTIPART_DIGEST_MISMATCH/);
    assert.strictEqual(harness.r2.calls.some((call) => call.method === 'part'), false);
  });

  it('completes with ordered receipts and commits metadata then quota', async function () {
    const harness = await createHarness();
    await initialize(harness);
    await uploadAll(harness);
    const result = await harness.service.complete({ uploadId: 'upload-1' });
    const call = harness.r2.calls.find((entry) => entry.method === 'complete');
    assert.deepStrictEqual(call.parts, [
      { partNumber: 1, etag: 'etag-1' },
      { partNumber: 2, etag: 'etag-2' },
      { partNumber: 3, etag: 'etag-3' },
    ]);
    assert.strictEqual(result.phase, 'completed');
    assert.strictEqual(harness.metadataCalls.length, 1);
    assert.strictEqual(harness.metadataCalls[0].metadata.storageConfigId, 'r2-a');
    assert.strictEqual(harness.metadataCalls[0].metadata.storageGeneration, 'generation-1');
    assert.strictEqual(harness.metadataCalls[0].metadata.uploadSource, 'drive');
    assert.deepStrictEqual(harness.referenceCalls.map((entry) => entry.method), [
      'reserve', 'commitStart', 'commitFinish',
    ]);
    assert.ok(harness.timeline.indexOf('metadata')
      < harness.timeline.indexOf('reference-commitFinish'));
    assert.strictEqual(harness.quotaCalls.at(-1).method, 'consume');
    assert.match(harness.metadataCalls[0].operationId, /^upload-1:\d+:publish$/);
    assert.match(harness.quotaCalls.at(-1).operationId, /^upload-1:\d+:consume$/);
    const reserveSequence = Number(harness.quotaCalls[0].operationId.split(':')[1]);
    const publishSequence = Number(harness.metadataCalls[0].operationId.split(':')[1]);
    const consumeSequence = Number(harness.quotaCalls.at(-1).operationId.split(':')[1]);
    assert.ok(reserveSequence < publishSequence && publishSequence < consumeSequence);
  });

  it('makes init, part, and complete retries idempotent', async function () {
    const harness = await createHarness();
    await initialize(harness);
    await harness.service.initialize(baseRequest());
    const bytes = Buffer.alloc(PART_SIZE, 1);
    const input = { uploadId: 'upload-1', partNumber: 1, bytes, digest: digest(bytes) };
    await harness.service.uploadPart(input);
    await harness.service.uploadPart(input);
    await uploadAll(harness);
    const first = await harness.service.complete({ uploadId: 'upload-1' });
    const retry = await harness.service.complete({ uploadId: 'upload-1' });
    assert.strictEqual(first.phase, 'completed');
    assert.strictEqual(retry.phase, 'completed');
    assert.strictEqual(harness.r2.calls.filter((call) => call.method === 'create').length, 1);
    assert.strictEqual(harness.r2.calls.filter((call) => call.method === 'part' && call.partNumber === 1).length, 1);
    assert.strictEqual(harness.r2.calls.filter((call) => call.method === 'complete').length, 1);
    assert.strictEqual(harness.quotaCalls.filter((call) => call.method === 'consume').length, 1);
  });

  it('reconciles an ambiguous complete through HEAD before publication', async function () {
    const harness = await createHarness();
    await initialize(harness);
    await uploadAll(harness);
    harness.r2.completeFailure = new Error('timeout after commit');
    const result = await harness.service.complete({ uploadId: 'upload-1' });
    assert.strictEqual(result.phase, 'completed');
    assert.strictEqual(harness.r2.calls.filter((call) => call.method === 'head').length, 1);
    assert.strictEqual(harness.metadataCalls.length, 1);
  });

  it('hard-fails when HEAD finds a conflicting deterministic object', async function () {
    const harness = await createHarness();
    await initialize(harness);
    await uploadAll(harness);
    harness.r2.completeFailure = new Error('timeout after commit');
    harness.r2.objectMetadataOverride = {
      uploadId: 'different-upload', rootDigest: 'a'.repeat(64),
      expectedSize: String((2 * PART_SIZE) + 3),
    };
    await assert.rejects(
      harness.service.complete({ uploadId: 'upload-1' }),
      /MULTIPART_OBJECT_CONFLICT/,
    );
    assert.deepStrictEqual(harness.metadataCalls, []);
    assert.strictEqual(harness.quotaCalls.some((call) => call.method === 'consume'), false);
  });

  it('classifies an unpersisted create as an orphan and retries the deterministic key', async function () {
    const harness = await createHarness();
    harness.repository.failWriteAt = 2;
    await assert.rejects(
      harness.service.initialize(baseRequest()),
      /MULTIPART_CREATE_AMBIGUOUS/,
    );
    assert.strictEqual(harness.repository.read().state.phase, 'creating');
    assert.deepStrictEqual(harness.alarms, [100_000]);
    harness.repository.failWriteAt = null;
    await harness.service.initialize(baseRequest());
    const creates = harness.r2.calls.filter((call) => call.method === 'create');
    assert.strictEqual(creates.length, 2);
    assert.deepStrictEqual(creates.map((call) => call.key), [
      'multipart/upload-1', 'multipart/upload-1',
    ]);
  });

  it('resumes publication and quota consumption without exposing early success', async function () {
    const harness = await createHarness();
    let publishAttempts = 0;
    harness.service.metadata.publish = async (input) => {
      publishAttempts += 1;
      if (publishAttempts === 1) throw new Error('publish unavailable');
      harness.metadataCalls.push(input);
    };
    await initialize(harness);
    await uploadAll(harness);
    await assert.rejects(harness.service.complete({ uploadId: 'upload-1' }), /publish unavailable/);
    assert.strictEqual(harness.repository.read().state.phase, 'publish_pending');
    const result = await harness.service.complete({ uploadId: 'upload-1' });
    assert.strictEqual(result.phase, 'completed');
    assert.strictEqual(harness.r2.calls.filter((call) => call.method === 'complete').length, 1);
  });

  it('retries quota commit with the same operation without republishing metadata', async function () {
    const harness = await createHarness();
    let consumeAttempts = 0;
    const operationIds = [];
    harness.service.quota.consume = async (input) => {
      operationIds.push(input.operationId);
      consumeAttempts += 1;
      if (consumeAttempts === 1) throw new Error('quota unavailable');
      harness.quotaCalls.push({ method: 'consume', ...input });
    };
    await initialize(harness);
    await uploadAll(harness);
    await assert.rejects(harness.service.complete({ uploadId: 'upload-1' }), /quota unavailable/);
    assert.strictEqual(harness.repository.read().state.phase, 'quota_pending');
    assert.strictEqual((await harness.service.complete({ uploadId: 'upload-1' })).phase, 'completed');
    assert.strictEqual(harness.metadataCalls.length, 1);
    assert.strictEqual(new Set(operationIds).size, 1);
  });

  it('aborts known uploads and deletes unpublished completed objects on alarm', async function () {
    const active = await createHarness();
    await initialize(active);
    assert.strictEqual((await active.service.cleanupExpired({ now: 100_001 })).phase, 'aborted');
    assert.strictEqual(active.r2.calls.some((call) => call.method === 'abort'), true);
    assert.strictEqual(active.quotaCalls.at(-1).method, 'cancel');

    const completed = await createHarness();
    await initialize(completed);
    await uploadAll(completed);
    completed.service.metadata.publish = async () => { throw new Error('offline'); };
    await assert.rejects(completed.service.complete({ uploadId: 'upload-1' }), /offline/);
    assert.strictEqual((await completed.service.cleanupExpired({ now: 100_001 })).phase, 'aborted');
    assert.strictEqual(completed.r2.calls.some((call) => call.method === 'delete'), true);
  });
});
