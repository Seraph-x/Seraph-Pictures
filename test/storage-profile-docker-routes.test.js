const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Hono } = require('hono');
const { createApp } = require('../server/app');
const { registerStorageConnectionRoutes } = require('../server/routes/storage/connections');

const HEADERS = Object.freeze({
  Accept: 'application/vnd.seraph.v2+json',
  'Content-Type': 'application/json',
  'X-Seraph-Client': 'app-v2',
});

function request(pathname, method, body) {
  return new Request(`http://localhost${pathname}`, {
    method,
    headers: HEADERS,
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe('Docker storage profile routes', function () {
  let root;
  let previous;

  beforeEach(function () {
    previous = { ...process.env };
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'seraph-storage-routes-'));
    Object.assign(process.env, {
      NODE_ENV: 'test', AUTH_DISABLED: 'true', DATA_DIR: root,
      DB_PATH: path.join(root, 'routes.db'), SETTINGS_STORE: 'sqlite',
      CONFIG_ENCRYPTION_KEY: 'route-profile-test-key',
      SESSION_SECRET: 'route-profile-session-key', TG_BOT_TOKEN: '', TG_CHAT_ID: '',
    });
  });

  afterEach(function () {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
    fs.rmSync(root, { recursive: true });
  });

  it('returns shared profile error envelopes from CRUD and stored tests', async function () {
    const app = createApp();
    const createdResponse = await app.fetch(request('/api/storage', 'POST', {
      name: 'Primary', type: 'telegram', config: { botToken: 'token', chatId: 'chat' },
    }));
    const created = await createdResponse.json();

    const locked = await app.fetch(request(`/api/storage/${created.item.id}`, 'DELETE'));
    assert.strictEqual(locked.status, 409);
    assert.strictEqual((await locked.json()).error.code, 'STORAGE_DEFAULT_LOCKED');
    const missing = await app.fetch(request('/api/storage/missing/test', 'POST'));
    assert.strictEqual(missing.status, 404);
    assert.strictEqual((await missing.json()).error.code, 'STORAGE_PROFILE_NOT_FOUND');
  });

  it('tests stored and draft adapters for every Docker storage type', async function () {
    const types = ['telegram', 'r2', 's3', 'discord', 'huggingface', 'webdav', 'github'];
    const items = new Map(types.map((type) => [`profile-${type}`, { id: `profile-${type}`, type }]));
    const observed = [];
    const adapter = (type, mode) => ({
      async testConnection() { observed.push(`${mode}:${type}`); return { connected: true }; },
    });
    const services = {
      storageRepo: { getById: (id) => items.get(id) || null },
      storageFactory: {
        createAdapter: (item) => adapter(item.type, 'stored'),
        createTemporaryAdapter: (type) => adapter(type, 'draft'),
      },
    };
    const helpers = {
      requireAuth: () => null,
      getServices: () => services,
      formatStatusDetail: (value) => value,
      jsonError: (context, status, code, message, detail) => context.json({
        success: false, error: { code, message, detail },
      }, status),
    };
    const app = new Hono();
    registerStorageConnectionRoutes(app, helpers);

    for (const type of types) {
      const stored = await app.request(`/api/storage/profile-${type}/test`, { method: 'POST' });
      const draft = await app.request('/api/storage/test', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, config: {} }),
      });
      assert.strictEqual(stored.status, 200, type);
      assert.strictEqual(draft.status, 200, type);
    }
    assert.strictEqual(observed.length, types.length * 2);
  });
});
