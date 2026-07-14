const assert = require('node:assert');

describe('frontend profile-aware Drive interface', function () {
  let drive;

  before(async function () {
    drive = await import('../frontend/src/utils/drive-profile-contract.js');
  });

  it('builds exact-profile tree and explorer queries', function () {
    assert.strictEqual(
      drive.buildDriveTreePath({ storage: 'telegram', storageId: 'tg-archive' }),
      '/api/drive/tree?storage=telegram&storageId=tg-archive',
    );
    assert.match(
      drive.buildDriveExplorerPath({ path: 'photos', storageId: 'tg-archive', includeStats: true }),
      /storageId=tg-archive/,
    );
  });

  it('builds an exact cross-profile migration payload', function () {
    assert.deepStrictEqual(drive.buildMigrationPayload({
      ids: ['file-1'], destinationStorageId: 'tg-primary',
    }), {
      ids: ['file-1'], destinationStorageId: 'tg-primary',
    });
  });

  it('keeps disabled sources visible but only enables valid migration destinations', function () {
    const profiles = [
      { id: 'source', enabled: true },
      { id: 'disabled-history', enabled: false },
      { id: 'destination', enabled: true },
    ];
    assert.deepStrictEqual(
      drive.migrationDestinations(profiles, ['source']).map((item) => item.id),
      ['destination'],
    );
    assert.strictEqual(profiles.length, 3);
  });

  it('excludes every selected source profile from mixed-profile migrations', function () {
    const profiles = [
      { id: 'source-a', enabled: true },
      { id: 'source-b', enabled: true },
      { id: 'destination', enabled: true },
    ];
    assert.deepStrictEqual(
      drive.migrationDestinations(profiles, ['source-a', 'source-b']).map((item) => item.id),
      ['destination'],
    );
  });

  it('keeps the latest exact-profile explorer result during overlapping loads', async function () {
    const { useDriveExplorer } = await import(
      '../frontend/src/composables/drive/useDriveExplorer.js'
    );
    let releaseOld;
    const oldResponse = new Promise((resolve) => { releaseOld = resolve; });
    const explorer = useDriveExplorer({
      t: (key) => key,
      api: {
        getDriveTree: async () => [],
        getDriveExplorer: async ({ storageId }) => (storageId
          ? { files: [{ name: 'exact' }], folders: [], list_complete: true }
          : oldResponse),
      },
    });
    const oldLoad = explorer.reloadExplorer();
    explorer.storageId.value = 'profile-a';
    await explorer.reloadExplorer();
    releaseOld({ files: [{ name: 'all' }], folders: [], list_complete: true });
    await oldLoad;
    assert.deepStrictEqual(explorer.files.value.map((item) => item.name), ['exact']);
  });
});
