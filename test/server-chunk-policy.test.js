const assert = require('node:assert');

const policyPath = '../server/lib/services/chunk-policy';

function loadPolicy() {
  return require(policyPath);
}

function assertPolicyError(callback, code) {
  assert.throws(callback, (error) => error?.code === code);
}

describe('Docker chunk upload policy', function () {
  it('creates an exact chunk plan', function () {
    const { createChunkPlan } = loadPolicy();
    const plan = createChunkPlan({ fileSize: 11, chunkSize: 5, totalChunks: 3 });

    assert.deepStrictEqual(plan, { fileSize: 11, chunkSize: 5, totalChunks: 3 });
  });

  it('rejects a totalChunks value inconsistent with file size', function () {
    const { createChunkPlan } = loadPolicy();

    assertPolicyError(
      () => createChunkPlan({ fileSize: 11, chunkSize: 5, totalChunks: 2 }),
      'CHUNK_PLAN_MISMATCH'
    );
  });

  it('rejects unsafe plan numbers', function () {
    const { createChunkPlan } = loadPolicy();

    assertPolicyError(
      () => createChunkPlan({ fileSize: Number.MAX_SAFE_INTEGER + 1, chunkSize: 5, totalChunks: 1 }),
      'INVALID_FILE_SIZE'
    );
    assertPolicyError(
      () => createChunkPlan({ fileSize: 10, chunkSize: 0, totalChunks: 2 }),
      'INVALID_CHUNK_SIZE'
    );
  });

  it('rejects invalid indexes and incorrect part sizes', function () {
    const { createChunkPlan, validateChunkPart } = loadPolicy();
    const plan = createChunkPlan({ fileSize: 11, chunkSize: 5, totalChunks: 3 });

    assertPolicyError(() => validateChunkPart({ plan, chunkIndex: -1, byteLength: 5 }), 'INVALID_CHUNK_INDEX');
    assertPolicyError(() => validateChunkPart({ plan, chunkIndex: 3, byteLength: 1 }), 'INVALID_CHUNK_INDEX');
    assertPolicyError(() => validateChunkPart({ plan, chunkIndex: 0, byteLength: 4 }), 'INVALID_CHUNK_SIZE');
    assertPolicyError(() => validateChunkPart({ plan, chunkIndex: 2, byteLength: 2 }), 'INVALID_CHUNK_SIZE');
  });
});
