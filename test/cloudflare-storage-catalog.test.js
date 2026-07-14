const assert = require('node:assert');

class MemoryKV {
  constructor() { this.values = new Map(); }
  async get(key, options) {
    const value = this.values.get(String(key));
    if (value == null) return null;
    return options?.type === 'json' ? JSON.parse(value) : value;
  }
  async put(key, value) { this.values.set(String(key), String(value)); }
}

function authority() {
  const state = { generation: null };
  return {
    state,
    binding: {
      idFromName: () => 'coordinator',
      get: () => ({
        async fetch(request) {
          const operation = new URL(request.url).pathname.split('/').at(-1);
          const payload = await request.json();
          if (operation === 'storageProfileCatalogReadAuthority') {
            return Response.json({ data: {
              initialized: state.generation !== null,
              generation: state.generation,
            } });
          }
          if (operation === 'storageProfileCatalogActivate') {
            state.generation = payload.generation;
            return Response.json({ data: { ok: true, generation: state.generation } });
          }
          return Response.json({ error: { code: 'UNKNOWN' } }, { status: 404 });
        },
      }),
    },
  };
}

function env(overrides = {}) {
  const coordinator = authority();
  return {
    environment: {
      CONFIG_ENCRYPTION_KEY: 'cloudflare-profile-key',
      img_url: new MemoryKV(), AUTH_COORDINATOR: coordinator.binding, ...overrides,
    },
    coordinator,
  };
}

describe('Cloudflare generation storage catalog', function () {
  it('stages and reads only the exact active generation', async function () {
    const { createStorageProfileRepository } = await import('../functions/services/storage-profiles/repository.js');
    const fixture = env();
    const repo = createStorageProfileRepository(fixture.environment);
    const telegram = await repo.create({
      name: 'main', type: 'telegram', config: { botToken: 'secret', chatId: 'chat' },
    });
    const github = await repo.create({
      name: 'git', type: 'github', config: { repo: 'u/r', token: 'gh-secret' },
    });
    const listed = await repo.list();

    assert.deepStrictEqual(listed.map((item) => item.id).sort(), [github.id, telegram.id].sort());
    assert.ok(listed.every((item) => item.isDefault));
    const visible = listed.find((item) => item.id === telegram.id);
    assert.strictEqual(visible.config.botToken, '********');
    assert.strictEqual(visible.secretsPresent.botToken, true);
    assert.match(fixture.coordinator.state.generation, /^[a-z0-9-]+$/i);
    assert.ok(fixture.environment.img_url.values.has(
      `storage_profiles:v2:${fixture.coordinator.state.generation}`,
    ));
  });

  it('keeps defaults independent and enforces default locking', async function () {
    const { createStorageProfileRepository } = await import('../functions/services/storage-profiles/repository.js');
    const fixture = env();
    const repo = createStorageProfileRepository(fixture.environment);
    const first = await repo.create({ name: 'one', type: 'telegram', config: {} });
    const second = await repo.create({ name: 'two', type: 'telegram', config: {} });
    await assert.rejects(() => repo.delete(first.id), { code: 'STORAGE_DEFAULT_LOCKED' });
    await repo.setDefault(second.id);
    assert.strictEqual((await repo.get(first.id, { includeSecrets: true })).isDefault, false);
    assert.strictEqual((await repo.get(second.id, { includeSecrets: true })).isDefault, true);
  });

  it('exposes v1 only through the explicit migration reader', async function () {
    const { createStorageCatalogStore } = await import('../functions/services/storage-profiles/catalog-store.js');
    const fixture = env();
    await fixture.environment.img_url.put('storage_profiles:v1', JSON.stringify({
      schemaVersion: 1, items: [{ id: 'legacy' }],
    }));
    const store = createStorageCatalogStore(fixture.environment);
    assert.strictEqual((await store.readLegacy()).items[0].id, 'legacy');
    assert.deepStrictEqual((await store.readActive()).items, []);
    await fixture.environment.img_url.put('storage_profiles:v1', JSON.stringify({
      schemaVersion: 2, items: [],
    }));
    await assert.rejects(() => store.readLegacy(), { code: 'STORAGE_CONFIG_UNAVAILABLE' });
  });

  it('fails closed on authority outage and invisible generations', async function () {
    const { createStorageProfileRepository } = await import('../functions/services/storage-profiles/repository.js');
    const broken = env({
      AUTH_COORDINATOR: { idFromName: () => 'id', get: () => ({ fetch: async () => {
        throw new Error('coordinator down');
      } }) },
    }).environment;
    await assert.rejects(() => createStorageProfileRepository(broken).list(), {
      code: 'STORAGE_CONFIG_UNAVAILABLE',
    });

    const fixture = env();
    fixture.coordinator.state.generation = 'missing';
    await assert.rejects(() => createStorageProfileRepository(fixture.environment).list(), {
      code: 'STORAGE_CONFIG_UNAVAILABLE',
    });
  });
});
