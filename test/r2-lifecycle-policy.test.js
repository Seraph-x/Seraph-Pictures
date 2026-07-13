const assert = require('node:assert');
const { R2_MULTIPART_LIFECYCLE } = require('../shared/storage/r2-lifecycle.cjs');

describe('R2 multipart lifecycle policy', function () {
  it('aborts only the coordinator multipart prefix after one day', async function () {
    const { createUploadRecord } = await import('../workers/coordinator/src/upload/upload-record.js');
    const record = createUploadRecord({
      uploadId: 'policy-check', totalParts: 1, expectedSize: 1,
      rootDigest: 'a'.repeat(64), owner: 'admin', visibility: 'private',
      expiresAt: 1,
    });

    assert.strictEqual(R2_MULTIPART_LIFECYCLE.abortMultipartDays, 1);
    assert.strictEqual(record.objectKey.startsWith(R2_MULTIPART_LIFECYCLE.prefix), true);
    assert.strictEqual('direct-upload'.startsWith(R2_MULTIPART_LIFECYCLE.prefix), false);
  });
});
