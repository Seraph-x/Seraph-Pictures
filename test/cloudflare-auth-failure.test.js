const assert = require('node:assert');

function makeCoordinator(data) {
  const stub = Object.freeze({
    async fetch() {
      return Response.json({ data });
    },
  });
  return Object.freeze({
    idFromName: () => 'coordinator-id',
    get: () => stub,
  });
}

function makeKv(result) {
  return Object.freeze({
    async get() {
      if (result instanceof Error) throw result;
      return result;
    },
    async put() {},
  });
}

async function assertStorageUnavailable(operation) {
  await assert.rejects(operation, (error) => (
    error?.code === 'STORAGE_CONFIG_UNAVAILABLE'
    && error?.status === 503
  ));
}

describe('Cloudflare storage configuration failure boundary', function () {
  it('does not expose environment credentials when the coordinator binding is absent', async function () {
    const { resolveStorageEnv } = await import('../functions/utils/storage-config.js');
    const env = { WEBDAV_PASSWORD: 'environment-secret', img_url: makeKv(null) };

    await assertStorageUnavailable(() => resolveStorageEnv(env));
  });

  it('fails closed after initialization when KV read throws or returns no committed record', async function () {
    const { resolveStorageEnv } = await import('../functions/utils/storage-config.js');
    const authority = Object.freeze({
      initialized: true,
      committedVersion: 2,
      digest: 'sha256:committed',
    });
    const base = {
      AUTH_COORDINATOR: makeCoordinator(authority),
      WEBDAV_PASSWORD: 'environment-secret',
    };

    await assertStorageUnavailable(() => resolveStorageEnv({ ...base, img_url: makeKv(new Error('KV outage')) }));
    await assertStorageUnavailable(() => resolveStorageEnv({ ...base, img_url: makeKv(null) }));
  });

  it('fails closed on schema corruption, authority disagreement, or decryption failure', async function () {
    const { resolveStorageEnv } = await import('../functions/utils/storage-config.js');
    const authority = Object.freeze({
      initialized: true,
      committedVersion: 2,
      digest: 'sha256:committed',
    });
    const base = {
      AUTH_COORDINATOR: makeCoordinator(authority),
      CONFIG_ENCRYPTION_KEY: 'test-key-123',
      WEBDAV_PASSWORD: 'environment-secret',
    };
    const records = [
      { version: 2, schemaVersion: 99, digest: authority.digest, config: {} },
      { version: 1, schemaVersion: 1, digest: authority.digest, config: {} },
      {
        version: 2,
        schemaVersion: 1,
        digest: authority.digest,
        config: { webdav: { password: 'enc:v1:not-valid' } },
      },
    ];

    for (const record of records) {
      await assertStorageUnavailable(() => resolveStorageEnv({ ...base, img_url: makeKv(record) }));
    }
  });

  it('uses environment configuration only while authority is explicitly uninitialized', async function () {
    const { resolveStorageEnv } = await import('../functions/utils/storage-config.js');
    const env = {
      AUTH_COORDINATOR: makeCoordinator({ initialized: false, committedVersion: null, digest: null }),
      img_url: makeKv(null),
      WEBDAV_BASE_URL: 'https://environment.example',
    };

    const resolved = await resolveStorageEnv(env);
    assert.strictEqual(resolved, env);
  });

  it('rejects a contradictory uninitialized authority envelope', async function () {
    const { resolveStorageEnv } = await import('../functions/utils/storage-config.js');
    const env = {
      AUTH_COORDINATOR: makeCoordinator({
        initialized: false,
        committedVersion: 1,
        digest: 'sha256:contradiction',
      }),
      img_url: makeKv(null),
      WEBDAV_PASSWORD: 'environment-secret',
    };

    await assertStorageUnavailable(() => resolveStorageEnv(env));
  });

  it('does not inherit omitted environment credentials after initialization', async function () {
    const { digestConfig } = await import('../functions/utils/storage-config/crypto.js');
    const { resolveStorageEnv } = await import('../functions/utils/storage-config.js');
    const config = Object.freeze({ webdav: { baseUrl: 'https://committed.example' } });
    const digest = await digestConfig(config);
    const record = Object.freeze({ schemaVersion: 1, version: 1, digest, config });
    const env = {
      AUTH_COORDINATOR: makeCoordinator({ initialized: true, committedVersion: 1, digest }),
      img_url: makeKv(record),
      WEBDAV_PASSWORD: 'environment-secret',
      WEBDAV_BASE_URL: 'https://environment.example',
    };

    const resolved = await resolveStorageEnv(env);

    assert.strictEqual(resolved.WEBDAV_BASE_URL, 'https://committed.example');
    assert.strictEqual(Object.hasOwn(resolved, 'WEBDAV_PASSWORD'), false);
  });

  it('returns a stable 503 from the administrator storage endpoint', async function () {
    const route = await import('../functions/api/storage-config.js');
    const authority = Object.freeze({
      initialized: true,
      committedVersion: 1,
      digest: 'sha256:committed',
    });
    const response = await route.onRequestGet({
      request: new Request('https://vault.example/api/storage-config'),
      env: {
        APP_ENV: 'local',
        AUTH_DISABLED: 'true',
        AUTH_COORDINATOR: makeCoordinator(authority),
        img_url: makeKv(null),
      },
    });
    const body = await response.json();

    assert.strictEqual(response.status, 503);
    assert.strictEqual(body.error.code, 'STORAGE_CONFIG_UNAVAILABLE');
    assert.strictEqual(JSON.stringify(body).includes('environment-secret'), false);
  });
});
