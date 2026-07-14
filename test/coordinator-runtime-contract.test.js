const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'workers/coordinator/wrangler.jsonc');
const INDEX_PATH = path.join(ROOT, 'workers/coordinator/src/index.js');
const ADAPTER_URL = pathToFileURL(
  path.join(ROOT, 'workers/coordinator/src/auth/auth-coordinator.js')
).href;
const PASSWORD_URL = pathToFileURL(
  path.join(ROOT, 'workers/coordinator/src/auth/password.js')
).href;

function createService() {
  return Object.freeze({
    status: () => ({ initialized: false, schemaVersion: 1 }),
    bootstrapLogin: async () => ({ ok: true }),
    verifySession: async () => true,
    changeCredentials: async () => ({ ok: true }),
    logout: async () => ({ ok: true }),
    configReadAuthority: async () => ({
      initialized: false,
      committedVersion: null,
      digest: null,
    }),
    mutationFreezeStatus: async () => ({
      frozen: true, generation: 'generation-1', audience: 'namespace', active: 0,
    }),
    storageRefReserve: async ({ operationId, storageId }) => ({
      operationId, storageId, state: 'reserved',
    }),
    storageProfileCatalogReadAuthority: async () => ({
      initialized: true, generation: 'catalog-1', ledgerGeneration: 'catalog-1',
    }),
  });
}

describe('coordinator runtime contract', function () {
  it('defines private SQLite-backed auth and upload Durable Object migrations', function () {
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    const binding = config.durable_objects.bindings.find((item) => item.name === 'AUTH_COORDINATOR');
    const uploadBinding = config.durable_objects.bindings.find((item) => item.name === 'UPLOAD_COORDINATOR');
    const sqliteClasses = config.migrations.flatMap((migration) => migration.new_sqlite_classes || []);

    assert.strictEqual(config.workers_dev, false);
    assert.ok(!('routes' in config));
    assert.strictEqual(binding.class_name, 'AuthCoordinator');
    assert.strictEqual(uploadBinding.class_name, 'UploadCoordinator');
    assert.ok(sqliteClasses.includes('AuthCoordinator'));
    assert.ok(sqliteClasses.includes('UploadCoordinator'));
    assert.deepStrictEqual(config.kv_namespaces.map((item) => item.binding), ['FILE_METADATA']);
    assert.deepStrictEqual(config.r2_buckets.map((item) => item.binding), ['UPLOAD_BUCKET']);
    assert.match(fs.readFileSync(INDEX_PATH, 'utf8'), /export \{ AuthCoordinator \}/);
    assert.match(fs.readFileSync(INDEX_PATH, 'utf8'), /export \{ UploadCoordinator \}/);
    assert.match(fs.readFileSync(INDEX_PATH, 'utf8'), /export\s+default\s+\{\s*\}/);
    assert.doesNotMatch(fs.readFileSync(INDEX_PATH, 'utf8'), /\bfetch\s*\(/);
  });

  it('rejects unknown and malformed internal operations', async function () {
    const { routeAuthOperation } = await import(ADAPTER_URL);
    const unknown = await routeAuthOperation({
      request: new Request('https://internal/auth/unknown', { method: 'POST', body: '{}' }),
      service: createService(),
    });
    const malformed = await routeAuthOperation({
      request: new Request('https://internal/auth/status', { method: 'POST', body: '{' }),
      service: createService(),
    });

    assert.strictEqual(unknown.status, 404);
    assert.deepStrictEqual(await unknown.json(), { error: { code: 'COORDINATOR_OPERATION_UNKNOWN' } });
    assert.strictEqual(malformed.status, 400);
    assert.deepStrictEqual(await malformed.json(), { error: { code: 'COORDINATOR_PAYLOAD_INVALID' } });
  });

  it('routes allowlisted operations with a stable envelope', async function () {
    const { routeAuthOperation } = await import(ADAPTER_URL);
    const response = await routeAuthOperation({
      request: new Request('https://internal/auth/status', { method: 'POST', body: '{}' }),
      service: createService(),
    });

    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual(await response.json(), {
      data: { initialized: false, schemaVersion: 1 },
    });
  });

  it('routes configuration authority operations through the private adapter', async function () {
    const { routeAuthOperation } = await import(ADAPTER_URL);
    const response = await routeAuthOperation({
      request: new Request('https://internal/config/configReadAuthority', {
        method: 'POST', body: '{}',
      }),
      service: createService(),
    });

    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual(await response.json(), {
      data: { initialized: false, committedVersion: null, digest: null },
    });
  });

  it('routes mutation freeze status through the private adapter', async function () {
    const { routeAuthOperation } = await import(ADAPTER_URL);
    const response = await routeAuthOperation({
      request: new Request('https://internal/mutation/mutationFreezeStatus', {
        method: 'POST', body: '{}',
      }),
      service: createService(),
    });

    assert.deepStrictEqual(await response.json(), {
      data: {
        frozen: true, generation: 'generation-1', audience: 'namespace', active: 0,
      },
    });
  });

  it('routes storage reference operations through the private adapter', async function () {
    const { routeAuthOperation } = await import(ADAPTER_URL);
    const response = await routeAuthOperation({
      request: new Request('https://internal/storage/storageRefReserve', {
        method: 'POST', body: JSON.stringify({ operationId: 'op-1', storageId: 'r2-a' }),
      }),
      service: createService(),
    });

    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual(await response.json(), {
      data: { operationId: 'op-1', storageId: 'r2-a', state: 'reserved' },
    });
  });

  it('routes storage catalog authority operations through the private adapter', async function () {
    const { routeAuthOperation } = await import(ADAPTER_URL);
    const response = await routeAuthOperation({
      request: new Request('https://internal/storage/storageProfileCatalogReadAuthority', {
        method: 'POST', body: '{}',
      }),
      service: createService(),
    });

    assert.deepStrictEqual(await response.json(), {
      data: { initialized: true, generation: 'catalog-1', ledgerGeneration: 'catalog-1' },
    });
  });

  it('hashes and verifies passwords without storing plaintext', async function () {
    const { createPasswordService } = await import(PASSWORD_URL);
    const passwords = createPasswordService({ cryptoImpl: globalThis.crypto });
    const record = await passwords.createRecord({ username: 'admin', password: 'secret', credVersion: 1 });

    assert.ok(!JSON.stringify(record).includes('secret'));
    assert.strictEqual(await passwords.verify({ password: 'secret' }, record), true);
    assert.strictEqual(await passwords.verify({ password: 'wrong' }, record), false);
  });
});
