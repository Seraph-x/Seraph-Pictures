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
});
