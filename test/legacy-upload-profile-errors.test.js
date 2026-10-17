const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const profiles = require('../legacy/pages/upload/profile-mixin.js');

function profileViewModel(api) {
  const storage = { getItem: () => null, setItem: () => {} };
  const mixin = profiles.createUploadProfileMixin({ api, storage });
  return Object.assign(mixin.data(), mixin.methods, {
    isGuest: false,
    storageMode: 'telegram',
  });
}

describe('legacy upload profile errors', function () {
  it('keeps an empty catalog explicit and visible without an unhandled rejection', async function () {
    const viewModel = profileViewModel({ listProfiles: async () => [] });
    await viewModel.loadStorageProfiles();

    assert.strictEqual(viewModel.storageId, '');
    assert.strictEqual(viewModel.storageProfileError, 'STORAGE_SELECTION_REQUIRED');
    const component = fs.readFileSync(path.resolve(
      __dirname, '../legacy/pages/upload/components/storage-target-picker.js',
    ), 'utf8');
    assert.match(component, /storageProfileError/);
    assert.match(component, /role="alert"/);
  });

  it('preserves R2 choices when the initial Telegram type has no configured backend', async function () {
    const r2 = { id: 'r2-default', type: 'r2', name: 'Cloudflare R2', enabled: true, isDefault: true };
    const viewModel = profileViewModel({ listProfiles: async () => [r2] });
    await viewModel.loadStorageProfiles();

    assert.deepStrictEqual(viewModel.storageProfiles, [r2]);
    assert.strictEqual(viewModel.storageId, '');
    assert.strictEqual(viewModel.storageProfileError, 'STORAGE_SELECTION_REQUIRED');

    viewModel.storageMode = 'r2';
    viewModel.resolveStorageProfile();
    assert.strictEqual(viewModel.storageId, r2.id);
    assert.strictEqual(viewModel.storageProfileError, '');
    assert.strictEqual(viewModel.storageTarget, 'r2 · Cloudflare R2');
  });

  it('clears an earlier selection error when a valid type is selected', function () {
    const r2 = { id: 'r2-default', type: 'r2', name: 'Cloudflare R2', enabled: true, isDefault: true };
    const viewModel = profileViewModel({});
    viewModel.storageProfiles = [r2];
    viewModel.storageMode = 'r2';
    viewModel.storageProfileError = 'STORAGE_SELECTION_REQUIRED';

    viewModel.resolveStorageProfile();
    assert.strictEqual(viewModel.storageProfileError, '');
    assert.strictEqual(viewModel.storageId, r2.id);
  });

  it('shows a selection error and clears the previous target when switching to an unconfigured type', function () {
    const r2 = { id: 'r2-default', type: 'r2', name: 'Cloudflare R2', enabled: true, isDefault: true };
    const viewModel = profileViewModel({});
    viewModel.storageProfiles = [r2];
    viewModel.storageMode = 'r2';
    viewModel.resolveStorageProfile();
    viewModel.storageMode = 'telegram';
    assert.doesNotThrow(() => viewModel.resolveStorageProfile());
    assert.strictEqual(viewModel.storageProfileError, 'STORAGE_SELECTION_REQUIRED');
    assert.strictEqual(viewModel.storageId, '');
    assert.strictEqual(viewModel.storageTarget, '');
    assert.deepStrictEqual(viewModel.storageProfiles, [r2]);
  });

  it('clears stale choices and exposes catalog request failures', async function () {
    const viewModel = profileViewModel({ listProfiles: async () => { throw new Error('STORAGE_CONFIG_UNAVAILABLE'); } });
    viewModel.storageProfiles = [{ id: 'stale' }];
    viewModel.storageId = 'stale';
    await viewModel.loadStorageProfiles();
    assert.deepStrictEqual(viewModel.storageProfiles, []);
    assert.strictEqual(viewModel.storageId, '');
    assert.strictEqual(viewModel.storageProfileError, 'STORAGE_CONFIG_UNAVAILABLE');
  });
});
