const assert = require('assert');
const fs = require('node:fs');
const path = require('node:path');
const { createApp } = require('../server/app');
const { UploadService } = require('../server/lib/services/upload-service');

class MemoryKV {
  constructor() {
    this.store = new Map();
  }

  async put(key, value = '', options = {}) {
    this.store.set(String(key), { value: String(value ?? ''), metadata: options.metadata || null });
  }

  async getWithMetadata(key) {
    const item = this.store.get(String(key));
    if (!item) return null;
    return { value: item.value, metadata: item.metadata };
  }

  async delete(key) {
    this.store.delete(String(key));
  }
}

describe('security regressions', function () {
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };

  afterEach(function () {
    global.fetch = originalFetch;
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key];
    }
    for (const [key, value] of Object.entries(originalEnv)) {
      process.env[key] = value;
    }
  });

  it('rejects private-network URL uploads in Cloudflare runtime before fetch', async function () {
    const { onRequestPost } = await import('../functions/api/upload-from-url.js');
    let fetched = false;
    global.fetch = async () => {
      fetched = true;
      return new Response('secret');
    };

    const urls = [
      'http://127.0.0.1/admin',
      'http://[::ffff:127.0.0.1]/admin',
    ];

    for (const url of urls) {
      const response = await onRequestPost({
        request: new Request('https://vault.example/api/upload-from-url', {
          method: 'POST',
          body: JSON.stringify({ url }),
        }),
        env: { AUTH_DISABLED: 'true', APP_ENV: 'local' },
      });

      assert.strictEqual(response.status, 400, url);
    }
    assert.strictEqual(fetched, false);
  });

  it('rejects private-network URL uploads in Docker runtime before fetch', async function () {
    let fetched = false;
    global.fetch = async () => {
      fetched = true;
      return new Response('secret');
    };

    const service = new UploadService({
      storageRepo: { resolveStorageSelection: () => ({ id: 's', type: 'telegram', name: 'T' }) },
      fileRepo: { create: (payload) => payload },
      storageFactory: { createAdapter: () => ({ upload: async () => ({}) }) },
    });

    await assert.rejects(
      () => service.uploadFromUrl({ url: 'http://169.254.169.254/latest/meta-data' }),
      /private|blocked|internal/i
    );
    assert.strictEqual(fetched, false);
  });

  it('requires an explicit Cloudflare URL upload host allowlist', async function () {
    const { onRequestPost } = await import('../functions/api/upload-from-url.js');
    let fetched = false;
    global.fetch = async () => {
      fetched = true;
      return new Response('secret');
    };

    const response = await onRequestPost({
      request: new Request('https://vault.example/api/upload-from-url', {
        method: 'POST',
        body: JSON.stringify({ url: 'https://files.example/public.png' }),
      }),
      env: { AUTH_DISABLED: 'true', APP_ENV: 'local' },
    });

    assert.strictEqual(response.status, 400);
    assert.strictEqual(fetched, false);
  });

  it('returns 400 when Cloudflare URL upload redirects to a private host', async function () {
    const { onRequestPost } = await import('../functions/api/upload-from-url.js');
    global.fetch = async () => new Response('', {
      status: 302,
      headers: { Location: 'http://127.0.0.1/admin' },
    });

    const response = await onRequestPost({
      request: new Request('https://vault.example/api/upload-from-url', {
        method: 'POST',
        body: JSON.stringify({ url: 'https://files.example/public.png' }),
      }),
      env: { AUTH_DISABLED: 'true', APP_ENV: 'local', URL_UPLOAD_ALLOWED_HOSTS: 'files.example' },
    });

    assert.strictEqual(response.status, 400);
  });

  it('rejects Docker URL uploads when DNS resolves to a private address', async function () {
    let requested = false;

    const service = new UploadService({
      storageRepo: { resolveStorageSelection: () => ({ id: 's', type: 'telegram', name: 'T' }) },
      fileRepo: { create: (payload) => payload },
      storageFactory: { createAdapter: () => ({ upload: async () => ({}) }) },
      resolveHostname: async () => [{ address: '127.0.0.1', family: 4 }],
      requestRemote: async () => {
        requested = true;
        return new Response('secret');
      },
    });

    await assert.rejects(
      () => service.uploadFromUrl({ url: 'https://files.example/public.png' }),
      /private|blocked|internal/i
    );
    assert.strictEqual(requested, false);
  });

  it('marks Docker private redirect rejections as client errors', async function () {
    const service = new UploadService({
      storageRepo: { resolveStorageSelection: () => ({ id: 's', type: 'telegram', name: 'T' }) },
      fileRepo: { create: (payload) => payload },
      storageFactory: { createAdapter: () => ({ upload: async () => ({}) }) },
      resolveHostname: async () => [{ address: '203.0.113.10', family: 4 }],
      requestRemote: async () => new Response('', {
        status: 302,
        headers: { Location: 'http://127.0.0.1/admin' },
      }),
    });

    await assert.rejects(
      () => service.uploadFromUrl({ url: 'https://files.example/public.png' }),
      (error) => error.status === 400 && /private|blocked|internal/i.test(error.message)
    );
  });

  it('rejects GET for Cloudflare legacy manage mutation endpoints', async function () {
    const modules = [
      ['delete', await import('../functions/api/manage/delete/[id].js')],
      ['toggleLike', await import('../functions/api/manage/toggleLike/[id].js')],
      ['block', await import('../functions/api/manage/block/[id].js')],
      ['white', await import('../functions/api/manage/white/[id].js')],
      ['editName', await import('../functions/api/manage/editName/[id].js')],
    ];

    for (const [endpoint, module] of modules) {
      const env = { img_url: new MemoryKV() };
      await env.img_url.put('img:file.png', '', {
        metadata: { fileName: 'file.png', TimeStamp: Date.now(), storageType: 'telegram' },
      });

      const response = await module.onRequest({
        request: new Request(`https://vault.example/api/manage/${endpoint}/img%3Afile.png`, { method: 'GET' }),
        env,
        params: { id: 'img%3Afile.png' },
      });

      assert.strictEqual(response.status, 405, endpoint);
    }
  });

  it('rejects GET for Docker legacy manage mutation endpoints', async function () {
    process.env.DATA_DIR = path.join(__dirname, '..', 'data', `tmp-methods-${Date.now()}`);
    process.env.DB_PATH = path.join(process.env.DATA_DIR, 'methods.db');
    process.env.BASIC_USER = '';
    process.env.BASIC_PASS = '';

    const app = createApp();
    const endpoints = ['toggleLike', 'editName', 'block', 'white', 'delete'];
    for (const endpoint of endpoints) {
      const response = await app.fetch(new Request(`http://localhost/api/manage/${endpoint}/img%3Afile.png`));
      assert.strictEqual(response.status, 405, endpoint);
    }
  });

  it('sanitizes external redirect targets in legacy login page', function () {
    const loginHtml = fs.readFileSync(path.join(__dirname, '..', 'login.html'), 'utf8');
    assert.match(loginHtml, /function sanitizeRedirectTarget/);
    assert.doesNotMatch(loginHtml, /window\.location\.replace\(redirect\);/);
  });

  it('does not enable Docker credentialed CORS for arbitrary origins', async function () {
    process.env.DATA_DIR = path.join(__dirname, '..', 'data', `tmp-cors-${Date.now()}`);
    process.env.DB_PATH = path.join(process.env.DATA_DIR, 'cors.db');
    process.env.BASIC_USER = '';
    process.env.BASIC_PASS = '';

    const app = createApp();
    const response = await app.fetch(new Request('http://localhost/api/health', {
      headers: { Origin: 'https://evil.example' },
    }));

    assert.notStrictEqual(response.headers.get('access-control-allow-origin'), 'https://evil.example');
    assert.notStrictEqual(response.headers.get('access-control-allow-credentials'), 'true');
  });

  it('keeps Cloudflare telemetry disabled unless SENTRY_DSN is configured', async function () {
    const { errorHandling } = await import('../functions/utils/middleware.js');
    let nextCalled = false;
    const response = await errorHandling({
      env: {},
      data: {},
      next: async () => {
        nextCalled = true;
        return new Response('ok');
      },
    });

    assert.strictEqual(nextCalled, true);
    assert.strictEqual(response.status, 200);
  });

  it('does not send sensitive request data to Cloudflare telemetry', async function () {
    const { telemetryData } = await import('../functions/utils/middleware.js');
    const tags = new Map();
    const contexts = new Map();
    const transaction = { finish() {} };

    await telemetryData({
      env: { SENTRY_DSN: 'https://example.invalid/1' },
      data: {
        telemetry: true,
        sentry: {
          setTag: (key, value) => tags.set(key, value),
          setContext: (key, value) => contexts.set(key, value),
          startTransaction: () => transaction,
        },
      },
      request: new Request('https://vault.example/file/demo.png?token=secret', {
        headers: {
          Authorization: 'Bearer secret',
          Cookie: 'session=secret',
          'User-Agent': 'test',
        },
      }),
      next: async () => new Response('ok'),
    });

    assert.strictEqual(tags.get('authorization'), undefined);
    assert.strictEqual(tags.get('cookie'), undefined);
    assert.strictEqual(tags.get('url'), undefined);
    assert.deepStrictEqual(contexts.get('request'), {
      method: 'GET',
      path: '/file/demo.png',
      host: 'vault.example',
    });
  });

  it('does not load hardcoded browser Sentry from the legacy admin page', function () {
    const adminHtml = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');

    assert.doesNotMatch(adminHtml, /js\.sentry-cdn\.com/);
  });
});
