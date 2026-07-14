const assert = require('node:assert');

const EXPECTED_OPERATIONS = Object.freeze({
  list: ['GET', '/api/storage/list', 'items'],
  create: ['POST', '/api/storage', 'item'],
  update: ['PUT', '/api/storage/sc%3Aprimary', 'item'],
  delete: ['DELETE', '/api/storage/sc%3Aprimary', 'success'],
  setDefault: ['POST', '/api/storage/default/sc%3Aprimary', 'item'],
  testById: ['POST', '/api/storage/sc%3Aprimary/test', 'result'],
  testDraft: ['POST', '/api/storage/test', 'result'],
});

describe('shared Storage API contract', function () {
  it('describes every frontend Storage operation', function () {
    const contract = require('../shared/storage/contracts.cjs');
    for (const [name, expected] of Object.entries(EXPECTED_OPERATIONS)) {
      const operation = contract.storageOperation(name, { id: 'sc:primary' });
      assert.deepStrictEqual(
        [operation.method, operation.path, operation.envelope], expected, name,
      );
      assert.strictEqual(operation.auth, 'admin', name);
      assert.ok(Object.isFrozen(operation), name);
    }
  });

  it('normalizes runtime records without leaking unrelated fields', function () {
    const { normalizeStorageItem } = require('../shared/storage/contracts.cjs');
    const item = normalizeStorageItem({
      id: 'sc:primary', name: 'Primary', type: 'r2', enabled: 1, is_default: 1,
      config: { bucket: 'files', secretAccessKey: 'real-secret' },
      metadata_json: '{"source":"kv"}', created_at: 10, updated_at: 20,
      encrypted_payload: 'must-not-leak',
    });
    assert.deepStrictEqual(item, {
      id: 'sc:primary', name: 'Primary', type: 'r2', enabled: true, isDefault: true,
      config: { bucket: 'files', accessKeyId: '', secretAccessKey: '********' },
      secretsPresent: { accessKeyId: false, secretAccessKey: true },
      metadata: { source: 'kv' }, createdAt: 10, updatedAt: 20,
    });
    assert.ok(Object.isFrozen(item) && Object.isFrozen(item.config));
    assert.strictEqual('encrypted_payload' in item, false);
  });

  it('shares profile policy error statuses with runtime routes', function () {
    const contract = require('../shared/storage/contracts.cjs');
    assert.deepStrictEqual(contract.storageErrorDetails({ code: 'STORAGE_PROFILE_NOT_FOUND' }), {
      code: 'STORAGE_PROFILE_NOT_FOUND', status: 404,
    });
    for (const code of [
      'STORAGE_DEFAULT_LOCKED', 'STORAGE_PROFILE_IN_USE', 'STORAGE_NOT_WRITABLE',
    ]) {
      assert.deepStrictEqual(contract.storageErrorDetails({ code }), { code, status: 409 });
    }
  });

  it('preserves stored secrets for blank and masked update fields', function () {
    const { mergeStorageConfig } = require('../shared/storage/contracts.cjs');
    const current = { bucket: 'old', accessKeyId: 'key', secretAccessKey: 'secret' };
    assert.deepStrictEqual(mergeStorageConfig('r2', current, {
      bucket: 'new', accessKeyId: '', secretAccessKey: '********',
    }), { bucket: 'new', accessKeyId: 'key', secretAccessKey: 'secret' });
  });

  it('creates stable list, item, result, and success envelopes', function () {
    const contract = require('../shared/storage/contracts.cjs');
    const item = { id: 'sc:one', name: 'One', type: 'telegram', config: {} };
    assert.deepStrictEqual(contract.storageEnvelope('items', [item]), {
      success: true, items: [contract.normalizeStorageItem(item)],
    });
    assert.deepStrictEqual(contract.storageEnvelope('item', item), {
      success: true, item: contract.normalizeStorageItem(item),
    });
    assert.deepStrictEqual(contract.storageEnvelope('result', { connected: 1 }), {
      success: true, result: { connected: true },
    });
    assert.deepStrictEqual(contract.storageEnvelope('success'), { success: true });
  });

  it('rejects missing IDs, unsupported operations, and invalid envelopes explicitly', function () {
    const contract = require('../shared/storage/contracts.cjs');
    assert.throws(() => contract.storageOperation('update'), /STORAGE_ID_REQUIRED/);
    assert.throws(() => contract.storageOperation('clone'), /API_OPERATION_UNSUPPORTED/);
    assert.throws(() => contract.storageEnvelope('unknown'), /API_ENVELOPE_UNSUPPORTED/);
    assert.throws(
      () => contract.normalizeStorageItem({ id: 'one', name: 'One', type: 'unknown' }),
      /STORAGE_BACKEND_UNSUPPORTED/,
    );
  });
});
