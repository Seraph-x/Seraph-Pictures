const assert = require('node:assert');

class MemoryKV {
  constructor() {
    this.values = new Map();
  }

  async get(key, options) {
    const value = this.values.get(String(key));
    if (value == null) return null;
    return options?.type === 'json' ? JSON.parse(value) : value;
  }

  async put(key, value) {
    this.values.set(String(key), String(value));
  }
}

function authCoordinator() {
  const state = { generation: null };
  const stub = Object.freeze({
    async fetch(request) {
      const operation = new URL(request.url).pathname.split('/').at(-1);
      const payload = await request.json();
      if (operation === 'storageProfileCatalogReadAuthority') {
        return Response.json({ data: {
          initialized: state.generation !== null, generation: state.generation,
          ledgerGeneration: state.generation,
        } });
      }
      if (operation === 'storageProfileCatalogActivate') {
        if (payload.generation !== state.generation
          && payload.expectedGeneration !== state.generation) {
          return Response.json({ data: {
            ok: false, code: 'STORAGE_GENERATION_CONFLICT', generation: state.generation,
          } });
        }
        state.generation = payload.generation;
        return Response.json({ data: {
          ok: true, generation: state.generation, ledgerGeneration: state.generation,
        } });
      }
      return Response.json({
        data: { initialized: true, schemaVersion: 1, legacyCleanupRequired: false },
      });
    },
  });
  return Object.freeze({ idFromName: () => 'admin-auth', get: () => stub, state });
}

function env(overrides = {}) {
  return {
    APP_ENV: 'local', AUTH_DISABLED: 'true',
    CONFIG_ENCRYPTION_KEY: 'storage-route-test-key',
    img_url: new MemoryKV(),
    AUTH_COORDINATOR: authCoordinator(),
    R2_BUCKET: { list: async () => ({ objects: [] }) },
    ...overrides,
  };
}

function context(url, environment, options = {}) {
  const request = new Request(`https://vault.example${url}`, {
    method: options.method || 'GET',
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  return { request, env: environment, params: options.params || {} };
}

async function body(response, status = 200) {
  assert.strictEqual(response.status, status);
  return response.json();
}

describe('Cloudflare Storage API routes', function () {
  let routes;

  before(async function () {
    routes = {
      list: await import('../functions/api/storage/list.js'),
      create: await import('../functions/api/storage.js'),
      item: await import('../functions/api/storage/[id].js'),
      setDefault: await import('../functions/api/storage/default/[id].js'),
      testById: await import('../functions/api/storage/[id]/test.js'),
      testDraft: await import('../functions/api/storage/test.js'),
    };
  });

  it('requires administrator authentication for every operation', async function () {
    const protectedEnv = env({ AUTH_DISABLED: undefined, AUTH_COORDINATOR: authCoordinator() });
    const calls = [
      () => routes.list.onRequestGet(context('/api/storage/list', protectedEnv)),
      () => routes.create.onRequestPost(context('/api/storage', protectedEnv, { method: 'POST', body: {} })),
      () => routes.item.onRequestPut(context('/api/storage/one', protectedEnv, { method: 'PUT', body: {}, params: { id: 'one' } })),
      () => routes.item.onRequestDelete(context('/api/storage/one', protectedEnv, { method: 'DELETE', params: { id: 'one' } })),
      () => routes.setDefault.onRequestPost(context('/api/storage/default/one', protectedEnv, { method: 'POST', params: { id: 'one' } })),
      () => routes.testById.onRequestPost(context('/api/storage/one/test', protectedEnv, { method: 'POST', params: { id: 'one' } })),
      () => routes.testDraft.onRequestPost(context('/api/storage/test', protectedEnv, { method: 'POST', body: {} })),
    ];
    for (const invoke of calls) {
      const response = await invoke();
      assert.strictEqual(response.status, 401);
      assert.strictEqual((await response.json()).error.code, 'AUTH_REQUIRED');
    }
  });

  it('creates, lists, updates, defaults, and deletes encrypted profiles', async function () {
    const environment = env();
    const created = await body(await routes.create.onRequestPost(context('/api/storage', environment, {
      method: 'POST',
      body: {
        name: 'Primary R2', type: 'r2', enabled: true,
        config: {
          adapterMode: 's3', endpoint: 'https://r2.example', bucket: 'images',
          accessKeyId: 'access', secretAccessKey: 'secret',
        },
      },
    })));
    const id = created.item.id;
    assert.strictEqual(created.item.config.secretAccessKey, '********');
    const storedCatalog = [...environment.img_url.values.values()].join('\n');
    assert.doesNotMatch(storedCatalog, /"secretAccessKey":"secret"/);
    assert.match(storedCatalog, /enc:v1:/);

    const listed = await body(await routes.list.onRequestGet(context('/api/storage/list', environment)));
    assert.deepStrictEqual(listed.items.map((item) => item.id), [id]);

    const updated = await body(await routes.item.onRequestPut(context(`/api/storage/${id}`, environment, {
      method: 'PUT', params: { id },
      body: { name: 'Updated R2', config: { bucket: 'new-images', secretAccessKey: '' } },
    })));
    assert.strictEqual(updated.item.name, 'Updated R2');
    const { createStorageProfileRepository } = await import('../functions/services/storage-profiles/repository.js');
    const stored = await createStorageProfileRepository(environment).get(id, { includeSecrets: true });
    assert.strictEqual(stored.config.secretAccessKey, 'secret');
    assert.strictEqual(stored.config.bucket, 'new-images');

    const defaulted = await body(await routes.setDefault.onRequestPost(context(
      `/api/storage/default/${id}`, environment, { method: 'POST', params: { id } },
    )));
    assert.strictEqual(defaulted.item.isDefault, true);

    const locked = await body(await routes.item.onRequestDelete(context(
      `/api/storage/${id}`, environment, { method: 'DELETE', params: { id } },
    )), 409);
    assert.strictEqual(locked.error.code, 'STORAGE_DEFAULT_LOCKED');
    const backup = await body(await routes.create.onRequestPost(context('/api/storage', environment, {
      method: 'POST', body: {
        name: 'Backup R2', type: 'r2',
        config: { adapterMode: 'binding', bindingName: 'R2_BUCKET' },
      },
    })));
    await body(await routes.setDefault.onRequestPost(context(
      `/api/storage/default/${backup.item.id}`, environment,
      { method: 'POST', params: { id: backup.item.id } },
    )));
    assert.deepStrictEqual(await body(await routes.item.onRequestDelete(context(
      `/api/storage/${id}`, environment, { method: 'DELETE', params: { id } },
    ))), { success: true });
    assert.deepStrictEqual((await body(await routes.list.onRequestGet(
      context('/api/storage/list', environment),
    ))).items.map((item) => item.id), [backup.item.id]);
  });

  it('tests stored and draft R2 profiles through the native binding', async function () {
    const environment = env();
    const created = await body(await routes.create.onRequestPost(context('/api/storage', environment, {
      method: 'POST', body: {
        name: 'R2', type: 'r2', config: { adapterMode: 'binding', bindingName: 'R2_BUCKET' },
      },
    })));
    const byId = await body(await routes.testById.onRequestPost(context(
      `/api/storage/${created.item.id}/test`, environment,
      { method: 'POST', params: { id: created.item.id } },
    )));
    const draft = await body(await routes.testDraft.onRequestPost(context('/api/storage/test', environment, {
      method: 'POST', body: {
        type: 'r2', config: { adapterMode: 'binding', bindingName: 'R2_BUCKET' },
      },
    })));
    assert.strictEqual(byId.result.connected, true);
    assert.strictEqual(draft.result.connected, true);
  });

  it('returns stable errors for unsupported types and missing profiles', async function () {
    const environment = env();
    const unsupported = await body(await routes.create.onRequestPost(context('/api/storage', environment, {
      method: 'POST', body: { name: 'Unknown', type: 'unknown', config: {} },
    })), 400);
    assert.strictEqual(unsupported.error.code, 'STORAGE_BACKEND_UNSUPPORTED');
    const missing = await body(await routes.item.onRequestDelete(context(
      '/api/storage/missing', environment, { method: 'DELETE', params: { id: 'missing' } },
    )), 404);
    assert.strictEqual(missing.error.code, 'STORAGE_PROFILE_NOT_FOUND');
  });

  it('fails closed on KV outages and missing encryption keys', async function () {
    const brokenKv = new MemoryKV();
    brokenKv.get = async () => { throw new Error('KV unavailable'); };
    const brokenEnv = env({ img_url: brokenKv });
    brokenEnv.AUTH_COORDINATOR.state.generation = 'active-generation';
    const unavailable = await body(await routes.list.onRequestGet(context(
      '/api/storage/list', brokenEnv,
    )), 503);
    assert.strictEqual(unavailable.error.code, 'STORAGE_CONFIG_UNAVAILABLE');

    const noKey = env({ CONFIG_ENCRYPTION_KEY: undefined });
    const rejected = await body(await routes.create.onRequestPost(context('/api/storage', noKey, {
      method: 'POST',
      body: {
        name: 'Telegram', type: 'telegram', config: { botToken: 'token', chatId: 'chat' },
      },
    })), 500);
    assert.strictEqual(rejected.error.code, 'NO_ENC_KEY');
    assert.strictEqual(noKey.img_url.values.size, 0);
  });
});
