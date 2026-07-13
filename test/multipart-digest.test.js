const assert = require('node:assert');
const { createHash } = require('node:crypto');

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

describe('browser multipart digest plan', function () {
  it('hashes bounded parts and derives the manifest root deterministically', async function () {
    const { createMultipartDigestPlan } = await import('../frontend/src/utils/multipart-digest.js');
    const file = new File([Uint8Array.of(1, 2, 3, 4, 5)], 'x.bin');
    const plan = await createMultipartDigestPlan(file, 2);
    const expectedParts = [
      hash(Uint8Array.of(1, 2)),
      hash(Uint8Array.of(3, 4)),
      hash(Uint8Array.of(5)),
    ];
    assert.deepStrictEqual([...plan.partDigests], expectedParts);
    assert.strictEqual(plan.rootDigest, hash(expectedParts.join(':')));
    assert.ok(Object.isFrozen(plan) && Object.isFrozen(plan.partDigests));
  });
});
