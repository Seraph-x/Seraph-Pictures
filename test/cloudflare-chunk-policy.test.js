const assert = require('node:assert');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const moduleUrl = pathToFileURL(
  path.resolve(__dirname, '../functions/utils/chunk-policy.js')
).href;

async function loadPolicy() {
  return import(moduleUrl);
}

function assertPolicyError(callback, code) {
  assert.throws(callback, (error) => error?.code === code);
}

describe('Cloudflare chunk upload policy', function () {
  it('creates an exact chunk plan', async function () {
    const { createChunkPlan } = await loadPolicy();
    const plan = createChunkPlan({ fileSize: 11, chunkSize: 5, totalChunks: 3 });

    assert.deepStrictEqual(plan, { fileSize: 11, chunkSize: 5, totalChunks: 3 });
  });

  it('rejects inconsistent totals and malformed parts', async function () {
    const { createChunkPlan, validateChunkPart } = await loadPolicy();

    assertPolicyError(
      () => createChunkPlan({ fileSize: 11, chunkSize: 5, totalChunks: 2 }),
      'CHUNK_PLAN_MISMATCH'
    );

    const plan = createChunkPlan({ fileSize: 11, chunkSize: 5, totalChunks: 3 });
    assertPolicyError(() => validateChunkPart({ plan, chunkIndex: 3, byteLength: 1 }), 'INVALID_CHUNK_INDEX');
    assertPolicyError(() => validateChunkPart({ plan, chunkIndex: 2, byteLength: 5 }), 'INVALID_CHUNK_SIZE');
  });
});
