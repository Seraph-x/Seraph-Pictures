const assert = require('node:assert');

const PROFILES = Object.freeze([
  Object.freeze({ id: 'tg-primary', name: 'Primary', type: 'telegram', enabled: true, isDefault: true }),
  Object.freeze({ id: 'tg-archive', name: 'Archive', type: 'telegram', enabled: false, isDefault: false }),
  Object.freeze({ id: 'tg-fast', name: 'Fast', type: 'telegram', enabled: true, isDefault: false }),
  Object.freeze({ id: 'r2-primary', name: 'R2 Primary', type: 'r2', enabled: true, isDefault: true }),
]);

function memory(initial = null) {
  let value = initial;
  return {
    getItem: () => value,
    setItem: (_key, next) => { value = next; },
    value: () => value,
  };
}

describe('frontend storage profile selection', function () {
  let selection;

  before(async function () {
    selection = await import('../frontend/src/utils/storage-profile-selection.js');
  });

  it('groups profiles and exposes enabled upload choices only', function () {
    const groups = selection.groupStorageProfiles(PROFILES);
    assert.deepStrictEqual(groups.map((group) => group.type), ['telegram', 'r2']);
    assert.deepStrictEqual(
      selection.enabledProfilesForType(PROFILES, 'telegram').map((profile) => profile.id),
      ['tg-primary', 'tg-fast'],
    );
    assert.strictEqual(selection.defaultProfileForType(PROFILES, 'telegram').id, 'tg-primary');
  });

  it('persists a versioned immutable per-type selection shape', function () {
    const storage = memory();
    selection.rememberStorageProfile(storage, 'telegram', 'tg-fast');
    selection.rememberStorageProfile(storage, 'r2', 'r2-primary');
    assert.deepStrictEqual(JSON.parse(storage.value()), {
      version: 1,
      byType: { telegram: 'tg-fast', r2: 'r2-primary' },
    });
    assert.strictEqual(selection.readRememberedStorageProfile(storage, 'telegram'), 'tg-fast');
  });

  it('shows a notice before replacing an invalid remembered profile with the type default', function () {
    const result = selection.selectStorageProfile({
      profiles: PROFILES, type: 'telegram', rememberedId: 'tg-archive',
    });
    assert.strictEqual(result.profile.id, 'tg-primary');
    assert.strictEqual(result.notice, 'STORAGE_PROFILE_SELECTION_RESET');
  });

  it('snapshots the exact queue target independently of later selector changes', function () {
    const snapshot = selection.snapshotStorageTarget({
      storageMode: 'telegram', profile: PROFILES[2], targetFolderPath: 'photos',
    });
    assert.deepStrictEqual(snapshot, {
      storageMode: 'telegram', storageId: 'tg-fast',
      storageName: 'Fast', targetFolderPath: 'photos',
    });
    assert.strictEqual(Object.isFrozen(snapshot), true);
  });

  it('defines explicit R2 adapter mode fields', async function () {
    const { getStorageFields } = await import('../frontend/src/config/storage-definitions.js');
    const fields = getStorageFields('r2');
    assert.deepStrictEqual(fields.find((field) => field.key === 'adapterMode').options, [
      { value: 'binding', label: 'Native Binding' },
      { value: 's3', label: 'S3 Credentials' },
    ]);
    assert.strictEqual(fields.find((field) => field.key === 'bindingName').when.adapterMode, 'binding');
    assert.strictEqual(fields.find((field) => field.key === 'endpoint').when.adapterMode, 's3');
  });
});
