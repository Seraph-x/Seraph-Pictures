const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function baseSource() {
  return {
    preferredType: 'telegram',
    cloudflare: {
      v1Catalog: {
        schemaVersion: 1,
        items: [
          { id: 'cf-old', name: 'Old', type: 'telegram', enabled: true, isDefault: true,
            config: { botToken: 'enc:v1:old', chatId: '1' }, createdAt: 10, updatedAt: 11 },
          { id: 'cf-new', name: 'New', type: 'telegram', enabled: true, isDefault: false,
            config: { botToken: 'enc:v1:new', chatId: '2' }, createdAt: 20, updatedAt: 21 },
        ],
      },
      legacyConfig: {
        r2: { bucket: 'legacy-binding' },
        telegramGuest: { botToken: 'guest-secret', chatId: 'guest' },
      },
      files: [
        { id: 'typed', storageType: 'telegram' },
        { id: 'bound', storageType: 'telegram', storageConfigId: 'cf-new' },
        { id: 'r2-file', storageType: 'r2' },
      ],
    },
    docker: {
      profiles: [
        { id: 'docker-one', name: 'Docker', type: 'webdav', enabled: true,
          isDefault: false, config: { baseUrl: 'https://dav' }, createdAt: 5, updatedAt: 6 },
      ],
      files: [{ id: 'docker-file', storageType: 'webdav', storageConfigId: 'docker-one' }],
    },
  };
}

describe('storage profile migration planner', function () {
  it('preserves IDs and deterministically plans defaults and legacy references', async function () {
    const { planStorageProfileMigration } = await import('../scripts/security/storage-profile-migration/planner.mjs');
    const first = planStorageProfileMigration(baseSource());
    const second = planStorageProfileMigration(baseSource());

    assert.deepStrictEqual(first, second);
    assert.ok(first.cloudflare.profiles.some((item) => item.id === 'cf-old'));
    assert.ok(first.docker.profiles.some((item) => item.id === 'docker-one'));
    assert.strictEqual(first.cloudflare.profiles.find((item) => item.id === 'cf-old').isDefault, true);
    assert.strictEqual(first.docker.profiles[0].isDefault, true);
    assert.strictEqual(first.cloudflare.legacyTypeProfileIds.telegram, 'cf-old');
    assert.strictEqual(first.cloudflare.referenceCounts['cf-old'], 1);
    assert.strictEqual(first.cloudflare.referenceCounts['cf-new'], 1);
    assert.strictEqual(first.steps.at(-1), 'write-marker');
    assert.ok(!JSON.stringify(first).includes('guest-secret'));
  });

  it('creates a stable R2 binding profile from legacy Cloudflare config', async function () {
    const { planStorageProfileMigration } = await import('../scripts/security/storage-profile-migration/planner.mjs');
    const plan = planStorageProfileMigration(baseSource());
    const r2 = plan.cloudflare.profiles.find((item) => item.type === 'r2');

    assert.match(r2.id, /^sc_legacy_[a-f0-9]{16}$/);
    assert.deepStrictEqual(r2.config, {
      adapterMode: 'binding', bindingName: 'R2_BUCKET', bucket: 'legacy-binding',
    });
    assert.strictEqual(plan.cloudflare.legacyTypeProfileIds.r2, r2.id);
  });

  it('rejects a type whose profiles are all disabled', async function () {
    const { planStorageProfileMigration } = await import('../scripts/security/storage-profile-migration/planner.mjs');
    const source = baseSource();
    source.docker.profiles = [{
      id: 'off', name: 'Off', type: 'github', enabled: false, isDefault: false,
      config: {}, createdAt: 1, updatedAt: 1,
    }];
    assert.throws(() => planStorageProfileMigration(source), { code: 'STORAGE_MIGRATION_FAILED' });
  });

  it('prints deterministic dry-run JSON and rejects apply explicitly', function () {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seraph-profile-migration-'));
    const input = path.join(root, 'source.json');
    fs.writeFileSync(input, JSON.stringify(baseSource()));
    const cli = path.join(__dirname, '..', 'scripts', 'security', 'migrate-storage-profiles.mjs');
    const dryRun = spawnSync(process.execPath, [cli, '--input', input], { encoding: 'utf8' });
    const repeated = spawnSync(process.execPath, [cli, '--input', input], { encoding: 'utf8' });
    const apply = spawnSync(process.execPath, [cli, '--input', input, '--apply'], { encoding: 'utf8' });

    assert.strictEqual(dryRun.status, 0, dryRun.stderr);
    assert.strictEqual(dryRun.stdout, repeated.stdout);
    assert.strictEqual(JSON.parse(dryRun.stdout).mode, 'dry-run');
    assert.notStrictEqual(apply.status, 0);
    assert.match(apply.stderr, /MIGRATION_EXECUTOR_NOT_AVAILABLE/);
    fs.rmSync(root, { recursive: true });
  });
});
