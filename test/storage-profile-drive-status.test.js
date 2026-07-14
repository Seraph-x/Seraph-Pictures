const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { initDatabase } = require('../server/db');
const { DriveQueryRepository } = require('../server/lib/repos/drive-query-repo');
const { VisibilityFileRepository } = require('../server/lib/repos/visibility-file-repo');
const { StorageConfigRepository } = require('../server/lib/repos/storage-config-repo');

const APP_CONFIG = Object.freeze({ configEncryptionKey: 'drive-status-test-key' });

function dockerFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seraph-drive-profile-'));
  const db = initDatabase(path.join(root, 'drive.db'));
  const storageRepo = new StorageConfigRepository(db, APP_CONFIG);
  const fileRepo = new VisibilityFileRepository(db);
  const first = storageRepo.create({
    name: 'Primary', type: 'telegram', config: { botToken: 'one', chatId: 'one' },
  });
  const second = storageRepo.create({
    name: 'Archive', type: 'telegram', config: { botToken: 'two', chatId: 'two' },
  });
  storageRepo.setDefault(second.id);
  storageRepo.update(first.id, { enabled: false });
  for (const profile of [first, second]) {
    fileRepo.create({
      id: `file-${profile.id}`, storageConfigId: profile.id, storageType: profile.type,
      storageKey: profile.id, fileName: `${profile.name}.jpg`, fileSize: 1,
      mimeType: 'image/jpeg', visibility: 'private', uploadSource: 'drive', accessVersion: 1,
    });
  }
  return { db, fileRepo, first, root, second, storageRepo };
}

describe('Profile-aware Drive queries', function () {
  it('filters Docker files by exact profile and exposes disabled profile identity', function () {
    const fixture = dockerFixture();
    try {
      const result = new DriveQueryRepository(fixture.db).listExplorer({
        folderPath: '', filters: { storageId: fixture.first.id },
      });
      assert.deepStrictEqual(result.files.map((file) => file.name), [`file-${fixture.first.id}`]);
      assert.deepStrictEqual(
        result.files[0].metadata,
        {
          ...result.files[0].metadata,
          storageId: fixture.first.id,
          storageName: 'Primary',
          storageType: 'telegram',
        },
      );
    } finally {
      fixture.db.close();
      fs.rmSync(fixture.root, { recursive: true });
    }
  });

  it('maps Cloudflare type-only files through the active generation legacy map', async function () {
    const { driveFileFromKey, fileMatches } = await import('../functions/services/drive/records.js');
    const snapshot = Object.freeze({
      generation: 'generation-2',
      items: Object.freeze([Object.freeze({
        id: 'tg-archive', name: 'Archive', type: 'telegram', enabled: false,
      })]),
      legacyTypeProfileIds: Object.freeze({ telegram: 'tg-archive' }),
    });
    const key = Object.freeze({
      name: 'legacy-file',
      metadata: Object.freeze({
        fileName: 'legacy.jpg', fileSize: 1, mimeType: 'image/jpeg',
        storageType: 'telegram', folderPath: '', visibility: 'private', TimeStamp: 1,
      }),
    });
    const file = driveFileFromKey(key, snapshot);
    assert.strictEqual(file.metadata.storageId, 'tg-archive');
    assert.strictEqual(file.metadata.storageName, 'Archive');
    const filters = {
      path: '', storageId: 'tg-archive', storageType: 'all',
      visibility: 'all', search: '', listType: 'all',
    };
    assert.strictEqual(fileMatches(file, filters, key.metadata), true);
    assert.strictEqual(fileMatches(file, { ...filters, storageId: 'tg-primary' }, key.metadata), false);
  });
});

describe('Per-profile status probes', function () {
  it('probes every Docker profile independently and keeps disabled profiles visible', async function () {
    const { collectDockerStatus, selectProbeConfigs } = require('../server/lib/services/status-service');
    const configs = [
      { id: 'tg-primary', name: 'Primary', type: 'telegram', enabled: true, isDefault: true },
      { id: 'tg-broken', name: 'Broken', type: 'telegram', enabled: true, isDefault: false },
      { id: 'tg-disabled', name: 'Disabled', type: 'telegram', enabled: false, isDefault: false },
    ];
    assert.deepStrictEqual(selectProbeConfigs(configs).map((item) => item.id), configs.map((item) => item.id));
    const result = await collectDockerStatus({
      services: {
        storageRepo: { list: () => configs },
        storageFactory: {
          createAdapter: (config) => ({
            testConnection: async () => config.id === 'tg-primary'
              ? { connected: true }
              : { connected: false, detail: 'profile unavailable' },
          }),
        },
        guestService: { getConfig: () => ({ enabled: false }) },
        settingsStore: { healthCheck: async () => ({ connected: true }) },
      },
      config: { bootstrapDefaultStorage: {} },
      formatDetail: (value) => String(value || ''),
      uploadLimits: {},
    });
    assert.deepStrictEqual(result.storageProfiles.map((item) => item.storageId), configs.map((item) => item.id));
    assert.strictEqual(result.storageProfiles[0].connected, true);
    assert.strictEqual(result.storageProfiles[1].connected, false);
    assert.strictEqual(result.storageProfiles[1].errorModel.detail, 'profile unavailable');
    assert.strictEqual(result.storageProfiles[2].enabled, false);
    assert.strictEqual(result.telegram.storageId, 'tg-primary');
  });

  it('returns one Cloudflare status record per profile without type aggregation', async function () {
    const { probeCloudflareProfiles } = await import('../functions/services/status-probes.js');
    const profiles = Object.freeze([
      Object.freeze({ id: 'tg-primary', name: 'Primary', type: 'telegram', enabled: true }),
      Object.freeze({ id: 'tg-broken', name: 'Broken', type: 'telegram', enabled: true }),
      Object.freeze({ id: 'tg-disabled', name: 'Disabled', type: 'telegram', enabled: false }),
    ]);
    const result = await probeCloudflareProfiles({
      profiles,
      probe: async (profile) => profile.id === 'tg-primary'
        ? { connected: true, enabled: true, configured: true, message: 'Connected' }
        : { connected: false, enabled: true, configured: true, message: 'profile unavailable' },
    });
    assert.deepStrictEqual(result.map((item) => item.storageId), profiles.map((item) => item.id));
    assert.strictEqual(result[0].connected, true);
    assert.strictEqual(result[1].errorModel.detail, 'profile unavailable');
    assert.strictEqual(result[2].enabled, false);
  });
});
