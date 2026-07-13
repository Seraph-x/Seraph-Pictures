const assert = require('node:assert');

const MARKER = Object.freeze({ version: 1, complete: true });

function markerKv(metadata, key = 'file-1') {
  return {
    async get(name) { return name === 'schema:visibility:v1' ? MARKER : null; },
    async getWithMetadata(name) {
      return name === key ? { value: '', metadata } : null;
    },
  };
}

function barrierCoordinator() {
  return {
    idFromName() { return 'coordinator-id'; },
    get() { return { async fetch(request) {
      const operation = new URL(request.url).pathname.split('/').at(-1);
      const data = operation === 'mutationEnter'
        ? { allowed: true, leaseId: 'lease-1', active: 1 }
        : { released: true, active: 0 };
      return Response.json({ data });
    } }; },
  };
}

describe('Cloudflare explicit file visibility', function () {
  it('conceals a private record from anonymous requests', async function () {
    const route = await import('../functions/file/[id].js');
    const metadata = {
      fileName: 'secret.png', visibility: 'private', uploadSource: 'drive', accessVersion: 1,
    };
    const response = await route.onRequest({
      request: new Request('https://vault.example/file/r2%3Asecret.png'),
      params: { id: 'r2:secret.png' },
      env: { img_url: markerKv(metadata, 'r2:secret.png') },
    });
    assert.strictEqual(response.status, 404);
  });

  it('updates visibility through the administrator adapter', async function () {
    const route = await import('../functions/api/manage/visibility/[id].js');
    let stored = {
      visibility: 'private', uploadSource: 'drive', accessVersion: 2, fileName: 'file.png',
    };
    const kv = markerKv(stored);
    kv.getWithMetadata = async (key) => (key === 'file-1' ? { value: '', metadata: stored } : null);
    kv.put = async (key, value, options) => { stored = options.metadata; };
    const response = await route.onRequestPut({
      request: new Request('https://vault.example/api/manage/visibility/file-1', {
        method: 'PUT', body: JSON.stringify({ visibility: 'public' }),
      }),
      params: { id: 'file-1' },
      env: { img_url: kv },
    });
    assert.strictEqual(response.status, 200);
    assert.strictEqual(stored.visibility, 'public');
    assert.strictEqual(stored.accessVersion, 3);
  });

  it('conceals a private record reached through a signed Telegram id', async function () {
    const { createSignedTelegramFileId } = await import('../functions/utils/telegram.js');
    const route = await import('../functions/file/[id].js');
    const metadata = {
      fileName: 'signed.png', visibility: 'private', uploadSource: 'legacy', accessVersion: 2,
    };
    const signedId = await createSignedTelegramFileId({
      fileId: 'telegram-file', fileExtension: 'png', fileName: 'signed.png',
    }, { FILE_URL_SECRET: 'test-secret' });
    const response = await route.onRequest({
      request: new Request(`https://vault.example/file/${encodeURIComponent(signedId)}`),
      params: { id: signedId },
      env: {
        img_url: markerKv(metadata, 'telegram-file.png'),
        FILE_URL_SECRET: 'test-secret',
      },
    });
    assert.strictEqual(response.status, 404);
  });

  it('does not recreate missing signed Telegram metadata after marker commit', async function () {
    const { createSignedTelegramFileId } = await import('../functions/utils/telegram.js');
    const route = await import('../functions/file/[id].js');
    let writes = 0;
    const signedId = await createSignedTelegramFileId({
      fileId: 'missing-file', fileExtension: 'png', fileName: 'missing.png',
    }, { FILE_URL_SECRET: 'test-secret' });
    const kv = markerKv(null, 'not-the-signed-file');
    kv.put = async () => { writes += 1; };
    const response = await route.onRequest({
      request: new Request(`https://vault.example/file/${encodeURIComponent(signedId)}`),
      params: { id: signedId },
      env: { img_url: kv, FILE_URL_SECRET: 'test-secret' },
    });

    assert.strictEqual(response.status, 404);
    assert.strictEqual(writes, 0);
  });

  it('fails closed on missing visibility after marker commit', async function () {
    const { authorizeFileRequest } = await import('../functions/services/file-access.js');
    const context = {
      request: new Request('https://vault.example/file/legacy'),
      env: { img_url: { async get() { return MARKER; } } },
    };
    await assert.rejects(
      () => authorizeFileRequest({ context, metadata: { fileName: 'legacy.png' } }),
      (error) => error?.code === 'FILE_VISIBILITY_INVALID',
    );
  });

  it('refuses to repair missing visibility after marker commit', async function () {
    const route = await import('../functions/api/manage/visibility/[id].js');
    let writes = 0;
    const kv = markerKv({ fileName: 'broken.png' }, 'broken');
    kv.put = async () => { writes += 1; };
    const response = await route.onRequestPut({
      request: new Request('https://vault.example/api/manage/visibility/broken', {
        method: 'PUT', body: JSON.stringify({ visibility: 'public' }),
      }),
      params: { id: 'broken' },
      env: { img_url: kv },
    });
    assert.strictEqual(response.status, 400);
    assert.strictEqual(writes, 0);
  });

  it('surfaces persistence failures instead of reporting validation errors', async function () {
    const route = await import('../functions/api/manage/visibility/[id].js');
    const metadata = {
      fileName: 'file.png', visibility: 'private', uploadSource: 'drive', accessVersion: 1,
    };
    const kv = markerKv(metadata);
    kv.put = async () => { throw new Error('KV unavailable'); };
    const context = {
      request: new Request('https://vault.example/api/manage/visibility/file', {
        method: 'PUT', body: JSON.stringify({ visibility: 'public' }),
      }),
      params: { id: 'file-1' },
      env: { img_url: kv },
    };
    await assert.rejects(() => route.onRequestPut(context), /KV unavailable/);
  });

  it('adds explicit API visibility at the KV write boundary', async function () {
    const middleware = await import('../functions/_middleware.js');
    let storedMetadata;
    const context = {
      request: new Request('https://vault.example/api/v1/upload', { method: 'POST' }),
      data: { fileVisibility: 'private' },
      env: {
        AUTH_COORDINATOR: barrierCoordinator(),
        img_url: { async put(key, value, options) { storedMetadata = options.metadata; } },
      },
      async next() {
        await this.env.img_url.put('file-1', '', {
          metadata: { fileName: 'file.png', TimeStamp: 1 },
        });
        return new Response('ok');
      },
    };
    await middleware.onRequest(context);
    assert.strictEqual(storedMetadata.visibility, 'private');
    assert.strictEqual(storedMetadata.uploadSource, 'api');
    assert.strictEqual(storedMetadata.accessVersion, 1);
    assert.strictEqual(context.env.TELEGRAM_METADATA_MODE, 'always');
  });

  it('rejects malformed explicit metadata at the KV write boundary', async function () {
    const middleware = await import('../functions/_middleware.js');
    const context = {
      request: new Request('https://vault.example/upload', { method: 'POST' }),
      env: {
        img_url: { async put() {} },
        AUTH_DISABLED: 'true',
        APP_ENV: 'local',
        AUTH_COORDINATOR: barrierCoordinator(),
      },
      async next() {
        await this.env.img_url.put('file-1', '', {
          metadata: {
            fileName: 'file.png', TimeStamp: 1, visibility: 'hidden',
            uploadSource: 'image-host', accessVersion: 1,
          },
        });
        return new Response('ok');
      },
    };
    await assert.rejects(
      () => middleware.onRequest(context),
      (error) => error?.code === 'FILE_VISIBILITY_INVALID',
    );
  });
});
