const assert = require('node:assert/strict');
const { createApp } = require('../server/app');
const { toStorageErrorPayload } = require('../server/lib/utils/storage-error');

function disabledUploadApp() {
  const error = Object.assign(new Error('STORAGE_NOT_WRITABLE'), {
    code: 'STORAGE_NOT_WRITABLE', status: 409,
  });
  return createApp({ container: {
    config: {
      uploadMaxSize: 1024,
      uploadSmallFileThreshold: 512,
      bootstrapDefaultStorage: { type: 'telegram' },
    },
    authService: { checkAuthentication: () => ({ authenticated: true }) },
    uploadService: { uploadFile: async () => { throw error; } },
  } });
}

describe('Docker storage error normalization', function () {
  it('preserves explicit storage policy errors', function () {
    const error = Object.assign(new Error('STORAGE_NOT_WRITABLE'), {
      code: 'STORAGE_NOT_WRITABLE',
      status: 409,
    });

    assert.deepStrictEqual(toStorageErrorPayload(error, error.status), {
      code: 'STORAGE_NOT_WRITABLE',
      message: 'STORAGE_NOT_WRITABLE',
      retriable: false,
      detail: 'STORAGE_NOT_WRITABLE',
      status: 409,
    });
  });

  it('still classifies upstream failures without explicit codes', function () {
    const payload = toStorageErrorPayload(new Error('request timeout'), 504);

    assert.strictEqual(payload.code, 'NETWORK_ERROR');
    assert.strictEqual(payload.retriable, true);
    assert.strictEqual(payload.status, 504);
  });

  it('returns the explicit policy code and status from direct uploads', async function () {
    const body = new FormData();
    body.set('file', new File(['x'], 'x.txt', { type: 'text/plain' }));
    body.set('storageMode', 'telegram');
    body.set('storageId', 'disabled-profile');

    const response = await disabledUploadApp().request('/upload', { method: 'POST', body });
    const payload = await response.json();

    assert.strictEqual(response.status, 409);
    assert.strictEqual(payload.errorCode, 'STORAGE_NOT_WRITABLE');
  });
});
