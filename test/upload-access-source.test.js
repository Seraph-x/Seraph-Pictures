const assert = require('node:assert');

describe('first-party upload source access metadata', function () {
  it('maps Cloudflare Drive writes to private access and image-host writes to public', async function () {
    const { normalizeFirstPartyUploadAccess } = await import(
      '../functions/services/upload-access.js'
    );
    assert.deepStrictEqual(normalizeFirstPartyUploadAccess({ uploadSource: 'drive' }), {
      visibility: 'private', uploadSource: 'drive', accessVersion: 1,
    });
    assert.deepStrictEqual(normalizeFirstPartyUploadAccess({ uploadSource: 'image-host' }), {
      visibility: 'public', uploadSource: 'image-host', accessVersion: 1,
    });
    assert.throws(() => normalizeFirstPartyUploadAccess({ uploadSource: 'guest' }), {
      code: 'FILE_UPLOAD_SOURCE_INVALID',
    });
  });

  it('applies the same explicit Drive boundary in Docker', function () {
    const { normalizeDockerUploadAccess } = require('../server/lib/services/upload-request');
    assert.deepStrictEqual(normalizeDockerUploadAccess({
      authenticated: true, uploadSource: 'drive',
    }), { uploadSource: 'drive', visibility: 'private' });
    assert.deepStrictEqual(normalizeDockerUploadAccess({
      authenticated: false, uploadSource: 'drive',
    }), { uploadSource: 'guest', visibility: 'public' });
  });
});
