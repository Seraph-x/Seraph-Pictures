const assert = require('node:assert');

const NOW_MS = 1_800_000_000_000;
const CURRENT_SECRET = 'current-secret-with-at-least-32-characters';
const PREVIOUS_SECRET = 'previous-secret-with-at-least-32-characters';

function coordinatorEnv(handler, overrides = {}) {
  return {
    FILE_SHARE_SECRET_CURRENT: CURRENT_SECRET,
    AUTH_COORDINATOR: {
      idFromName() { return 'id'; },
      get() {
        return {
          async fetch(request) {
            const operation = new URL(request.url).pathname.split('/').pop();
            const payload = await request.json();
            return Response.json({ data: await handler(operation, payload) });
          },
        };
      },
    },
    ...overrides,
  };
}

describe('Cloudflare private shares', function () {
  it('creates a coordinator record and a four-field HMAC link', async function () {
    const { createCloudflareShare, verifyShareSignature } = await import(
      '../functions/services/share-access.js'
    );
    let created;
    const env = coordinatorEnv((operation, payload) => {
      assert.strictEqual(operation, 'shareCreate');
      created = payload;
      return { ok: true, record: payload };
    });

    const result = await createCloudflareShare({
      env,
      fileId: 'file-1',
      accessVersion: 3,
      ttlSeconds: 60,
      maxDownloads: 2,
      shareId: 'share-1',
      nowMs: NOW_MS,
    });

    assert.strictEqual(created.expiresAt, NOW_MS + 60_000);
    assert.strictEqual(created.maxDownloads, 2);
    assert.strictEqual(result.sharePath.startsWith('/s/share-1?exp='), true);
    assert.strictEqual(await verifyShareSignature({
      env, record: created, signature: result.signature, nowMs: NOW_MS,
    }), true);
  });

  it('accepts a previous signature only during the configured rotation window', async function () {
    const { signShareRecord, verifyShareSignature } = await import(
      '../functions/services/share-access.js'
    );
    const record = {
      shareId: 'share-1', fileId: 'file-1', expiresAt: NOW_MS + 60_000, accessVersion: 3,
    };
    const signature = await signShareRecord(record, PREVIOUS_SECRET);
    const activeEnv = coordinatorEnv(() => ({}), {
      FILE_SHARE_SECRET_PREVIOUS: PREVIOUS_SECRET,
      FILE_SHARE_SECRET_PREVIOUS_VALID_UNTIL: String(NOW_MS + 1),
    });
    const expiredEnv = { ...activeEnv, FILE_SHARE_SECRET_PREVIOUS_VALID_UNTIL: String(NOW_MS) };

    assert.strictEqual(await verifyShareSignature({
      env: activeEnv, record, signature, nowMs: NOW_MS,
    }), true);
    assert.strictEqual(await verifyShareSignature({
      env: expiredEnv, record, signature, nowMs: NOW_MS,
    }), false);
  });

  it('verifies a password then atomically consumes the share', async function () {
    const {
      authorizeCloudflareShare,
      createCloudflareShare,
      finalizeCloudflareShare,
    } = await import('../functions/services/share-access.js');
    let record;
    const env = coordinatorEnv((operation, payload) => {
      if (operation === 'shareCreate') {
        record = payload;
        return { ok: true, record };
      }
      if (operation === 'shareRead') return { record };
      if (operation === 'shareConsume') {
        assert.strictEqual(payload.passwordVerified, true);
        return { ok: true, record: { ...record, downloadCount: 1 } };
      }
      throw new Error(`Unexpected operation ${operation}`);
    });
    const created = await createCloudflareShare({
      env,
      fileId: 'file-1',
      accessVersion: 3,
      ttlSeconds: 60,
      password: 'secret',
      maxDownloads: 1,
      shareId: 'share-1',
      nowMs: NOW_MS,
    });
    const request = new Request(
      `https://vault.example/file/file-1?share=share-1&exp=${record.expiresAt}&sig=${created.signature}`,
      { headers: { 'X-Share-Password': 'secret' } },
    );

    const share = await authorizeCloudflareShare({
      context: { request, env }, fileId: 'file-1', accessVersion: 3, nowMs: NOW_MS,
    });

    assert.strictEqual(share.access.accessVersion, 3);
    assert.strictEqual(share.access.expiresAt, Math.floor(record.expiresAt / 1000));
    const response = await finalizeCloudflareShare({
      context: { request, env }, authorization: share, response: new Response('ok'), nowMs: NOW_MS,
    });
    assert.strictEqual(response.status, 200);
  });

  it('creates an administrator share without changing the frontend API path', async function () {
    const route = await import('../functions/api/share/sign.js');
    const metadata = {
      fileName: 'private.png', visibility: 'private', uploadSource: 'drive', accessVersion: 4,
    };
    const env = coordinatorEnv((operation, payload) => {
      assert.strictEqual(operation, 'shareCreate');
      return { ok: true, record: payload };
    }, {
      AUTH_DISABLED: 'true',
      APP_ENV: 'local',
      img_url: {
        async get(key) {
          return key === 'schema:visibility:v1' ? { version: 1, complete: true } : null;
        },
        async getWithMetadata(key) {
          return key === 'r2:private.png' ? { value: '', metadata } : null;
        },
      },
    });
    const response = await route.onRequestPost({
      request: new Request('https://vault.example/api/share/sign', {
        method: 'POST',
        body: JSON.stringify({ fileId: 'r2:private.png', ttlSeconds: 60 }),
      }),
      env,
    });
    assert.strictEqual(response.status, 200, await response.clone().text());
    const body = await response.json();
    assert.strictEqual(body.shareUrl.startsWith('https://vault.example/s/'), true);
    assert.strictEqual(body.shareUrl.includes('sig='), true);
  });

  it('returns a canonical URL for public files without coordinator state', async function () {
    const route = await import('../functions/api/share/sign.js');
    const env = coordinatorEnv(() => {
      throw new Error('coordinator must not be called');
    }, {
      AUTH_DISABLED: 'true',
      APP_ENV: 'local',
      img_url: {
        async get() { return { version: 1, complete: true }; },
        async getWithMetadata() {
          return { value: '', metadata: {
            visibility: 'public', uploadSource: 'drive', accessVersion: 1,
          } };
        },
      },
    });
    const response = await route.onRequestPost({
      request: new Request('https://vault.example/api/share/sign', {
        method: 'POST', body: JSON.stringify({ fileId: 'r2:public.png' }),
      }),
      env,
    });
    const body = await response.json();

    assert.strictEqual(body.permission, 'public-read');
    assert.strictEqual(body.shareUrl, 'https://vault.example/file/r2%3Apublic.png');
  });

  it('rejects malformed coordinator share records explicitly', async function () {
    const { readCloudflareShare } = await import('../functions/services/share-access.js');
    const env = coordinatorEnv(() => ({ record: { shareId: 'incomplete' } }));

    await assert.rejects(
      () => readCloudflareShare(env, 'incomplete'),
      (error) => error.code === 'AUTH_COORDINATOR_RESPONSE_INVALID',
    );
  });

  it('resolves a new share id to the canonical file route', async function () {
    const route = await import('../functions/s/[slug].js');
    const record = {
      shareId: 'share-1', fileId: 'r2:file.png', expiresAt: NOW_MS + 60_000,
      accessVersion: 2, revoked: false, passwordHash: null, maxDownloads: null,
      downloadCount: 0, createdAt: NOW_MS,
    };
    const env = coordinatorEnv((operation, payload) => {
      assert.strictEqual(operation, 'shareRead');
      return { record };
    });
    const response = await route.onRequest({
      request: new Request(`https://vault.example/s/share-1?exp=${record.expiresAt}&sig=abc`),
      params: { slug: 'share-1' },
      env,
    });

    assert.strictEqual(response.status, 302);
    const location = new URL(response.headers.get('location'));
    assert.strictEqual(location.pathname, '/file/r2%3Afile.png');
    assert.strictEqual(location.searchParams.get('share'), 'share-1');
  });

});
