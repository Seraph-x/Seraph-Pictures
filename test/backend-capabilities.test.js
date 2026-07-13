const assert = require('node:assert');

const MIB = 1024 * 1024;

describe('shared backend upload capabilities', function () {
  it('defines R2 multipart and bounded Cloudflare alternatives', function () {
    const policy = require('../shared/storage/capabilities.cjs');
    const r2 = policy.resolveCapability({ runtime: 'cloudflare', type: 'r2' });
    const telegram = policy.resolveCapability({ runtime: 'cloudflare', type: 'telegram' });
    assert.deepStrictEqual(r2.modes, ['direct', 'multipart']);
    assert.strictEqual(r2.maxBytes, 100 * MIB);
    assert.deepStrictEqual(telegram.modes, ['direct']);
    assert.strictEqual(telegram.maxBytes, 20 * MIB);
    assert.ok(Object.isFrozen(r2) && Object.isFrozen(r2.modes));
  });

  it('uses the configured Docker Telegram administrator limit', function () {
    const policy = require('../shared/storage/capabilities.cjs');
    const capability = policy.resolveCapability({
      runtime: 'docker', type: 'telegram', adminMaxBytes: 40 * MIB,
    });
    assert.strictEqual(capability.maxBytes, 40 * MIB);
    assert.deepStrictEqual(capability.modes, ['direct', 'chunked']);
  });

  it('keeps guest Telegram at 20 MiB regardless of administrator limits', function () {
    const policy = require('../shared/storage/capabilities.cjs');
    const capability = policy.resolveCapability({
      runtime: 'docker', type: 'telegram', audience: 'guest', adminMaxBytes: 50 * MIB,
    });
    assert.strictEqual(capability.maxBytes, 20 * MIB);
    assert.deepStrictEqual(capability.modes, ['direct']);
  });

  it('marks S3 and WebDAV streaming without claiming multipart support', function () {
    const policy = require('../shared/storage/capabilities.cjs');
    for (const type of ['s3', 'webdav']) {
      const capability = policy.resolveCapability({ runtime: 'cloudflare', type });
      assert.strictEqual(capability.streaming, true);
      assert.strictEqual(capability.modes.includes('multipart'), false);
    }
  });

  it('rejects unknown modes, unsupported modes, and oversize files explicitly', function () {
    const policy = require('../shared/storage/capabilities.cjs');
    assert.throws(() => policy.validateUploadCapability({
      runtime: 'cloudflare', type: 'unknown', mode: 'direct', fileSize: 1,
    }), /STORAGE_BACKEND_UNSUPPORTED/);
    assert.throws(() => policy.validateUploadCapability({
      runtime: 'cloudflare', type: 'telegram', mode: 'multipart', fileSize: 1,
    }), /STORAGE_UPLOAD_MODE_UNSUPPORTED/);
    assert.throws(() => policy.validateUploadCapability({
      runtime: 'cloudflare', type: 'telegram', mode: 'direct', fileSize: (20 * MIB) + 1,
    }), /STORAGE_FILE_TOO_LARGE/);
  });
});
