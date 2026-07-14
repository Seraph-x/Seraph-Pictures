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
    assert.deepStrictEqual(first.cloudflare.references, [
      { operationId: 'migration:bound', storageId: 'cf-new' },
      { operationId: 'migration:r2-file', storageId: first.cloudflare.legacyTypeProfileIds.r2 },
      { operationId: 'migration:typed', storageId: 'cf-old' },
    ]);
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

  it('preserves distinct same-type legacy profiles in both runtimes', async function () {
    const { planStorageProfileMigration } = await import('../scripts/security/storage-profile-migration/planner.mjs');
    const source = baseSource();
    source.cloudflare.legacyConfig.telegram = { botToken: 'different', chatId: '3' };
    source.docker.legacyConfig = {
      webdav: { baseUrl: 'https://other', bearerToken: 'other-token' },
    };
    const plan = planStorageProfileMigration(source);
    assert.strictEqual(plan.cloudflare.profiles.filter((item) => item.type === 'telegram').length, 3);
    assert.strictEqual(plan.docker.profiles.filter((item) => item.type === 'webdav').length, 2);
  });

  it('uses the pre-migration global default when no explicit preferred type exists', async function () {
    const { planStorageProfileMigration } = await import('../scripts/security/storage-profile-migration/planner.mjs');
    const source = baseSource();
    delete source.preferredType;
    source.preMigrationGlobalDefaultType = 'github';
    assert.strictEqual(planStorageProfileMigration(source).preferredType, 'github');
  });

  it('prints deterministic dry-run JSON and requires explicit apply artifacts', function () {
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
    assert.match(apply.stderr, /MIGRATION_DRIVER_REQUIRED/);
    fs.rmSync(root, { recursive: true });
  });

  it('executes apply through an explicit driver and materializes both backups', function () {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seraph-profile-apply-'));
    const input = path.join(root, 'source.json');
    const driver = path.join(root, 'driver.mjs');
    const cloudflareBackup = path.join(root, 'cloudflare.json');
    const dockerBackup = path.join(root, 'docker.sqlite');
    fs.writeFileSync(input, JSON.stringify(baseSource()));
    fs.writeFileSync(driver, migrationDriverSource());
    const cli = path.join(__dirname, '..', 'scripts', 'security', 'migrate-storage-profiles.mjs');
    const apply = spawnSync(process.execPath, [
      cli, '--input', input, '--apply', '--driver', driver,
      '--token', 'test-owner-token',
      '--cloudflare-backup', cloudflareBackup, '--docker-backup', dockerBackup,
    ], { encoding: 'utf8' });

    assert.strictEqual(apply.status, 0, apply.stderr);
    assert.strictEqual(JSON.parse(apply.stdout).mode, 'apply');
    assert.strictEqual(fs.existsSync(cloudflareBackup), true);
    assert.strictEqual(fs.existsSync(dockerBackup), true);
    fs.rmSync(root, { recursive: true });
  });
});

function migrationDriverSource() {
  return `
    import fs from 'node:fs';
    export function createMigrationTargets() {
      const cloudflare = {
        backup: async ({ path }) => { fs.writeFileSync(path, '{}'); return path; },
        freezeBegin: async () => ({ generation: 'freeze-1', audience: 'storage-profiles', active: 0 }),
        readAuthority: async () => ({ initialized: false, generation: null }),
        stageCatalog: async () => ({ generation: 'g1' }), stageLedger: async () => {},
        validateStage: async () => {}, activate: async () => ({ ok: true, generation: 'g1' }),
        verifyLive: async () => {}, writeMarker: async () => {}, rollback: async () => {},
        freezeEnd: async () => {}, freezeAbort: async () => {},
      };
      const docker = {
        backup: async ({ path }) => { fs.writeFileSync(path, 'sqlite'); return path; },
        acquire: async () => {}, apply: async () => {}, verifyLive: async () => {},
        writeMarker: async () => {}, release: async () => {},
      };
      return { cloudflare, docker };
    }
  `;
}

describe('storage profile migration executor', function () {
  async function executorFixture(overrides = {}) {
    const events = [];
    const cloudflare = {
      backup: async () => { events.push('cf:backup'); return '/backup/cf.json'; },
      freezeBegin: async () => {
        events.push('cf:freeze');
        return { generation: 'freeze-1', audience: 'storage-profiles', active: 0 };
      },
      readAuthority: async () => ({ initialized: false, generation: null }),
      stageCatalog: async () => { events.push('cf:stage-catalog'); return { generation: 'g1' }; },
      stageLedger: async () => { events.push('cf:stage-ledger'); },
      validateStage: async () => { events.push('cf:validate'); },
      activate: async () => { events.push('cf:activate'); return { ok: true, generation: 'g1' }; },
      verifyLive: async () => { events.push('cf:verify'); },
      writeMarker: async () => { events.push('cf:marker'); },
      rollback: async () => { events.push('cf:rollback'); },
      freezeEnd: async () => { events.push('cf:unfreeze'); },
      freezeAbort: async () => { events.push('cf:abort-freeze'); },
      ...overrides.cloudflare,
    };
    const docker = {
      backup: async () => { events.push('docker:backup'); return '/backup/db.sqlite'; },
      acquire: async () => { events.push('docker:lock'); },
      apply: async () => { events.push('docker:apply'); },
      verifyLive: async () => { events.push('docker:verify'); },
      writeMarker: async () => { events.push('docker:marker'); },
      release: async () => { events.push('docker:unlock'); },
      ...overrides.docker,
    };
    const { executeStorageProfileMigration } = await import(
      '../scripts/security/storage-profile-migration/executor.mjs'
    );
    return { cloudflare, docker, events, executeStorageProfileMigration };
  }

  it('backs up, locks, stages, activates, verifies, marks, and unlocks in order', async function () {
    const fixture = await executorFixture();
    const result = await fixture.executeStorageProfileMigration({
      plan: baseSource(), cloudflare: fixture.cloudflare, docker: fixture.docker,
      owner: 'operator', token: 'token-1',
    });

    assert.strictEqual(result.generation, 'g1');
    assert.deepStrictEqual(result.backups, {
      cloudflare: '/backup/cf.json', docker: '/backup/db.sqlite',
    });
    assert.deepStrictEqual(fixture.events, [
      'cf:backup', 'docker:backup', 'docker:lock', 'cf:freeze',
      'cf:stage-catalog', 'cf:stage-ledger', 'cf:validate', 'docker:apply',
      'cf:activate', 'cf:verify', 'docker:verify', 'cf:marker', 'docker:marker',
      'cf:unfreeze', 'docker:unlock',
    ]);
  });

  it('does not activate a failed stage and releases acquired locks explicitly', async function () {
    const fixture = await executorFixture({
      cloudflare: { validateStage: async () => { throw new Error('invalid stage'); } },
    });

    await assert.rejects(fixture.executeStorageProfileMigration({
      plan: baseSource(), cloudflare: fixture.cloudflare, docker: fixture.docker,
      owner: 'operator', token: 'token-1',
    }), /invalid stage/);
    assert.ok(!fixture.events.includes('cf:activate'));
    assert.deepStrictEqual(fixture.events.slice(-2), ['cf:abort-freeze', 'docker:unlock']);
  });

  it('rolls authority back before aborting a failed post-activation verification', async function () {
    const fixture = await executorFixture({
      cloudflare: { verifyLive: async () => { throw new Error('invisible generation'); } },
    });

    await assert.rejects(fixture.executeStorageProfileMigration({
      plan: baseSource(), cloudflare: fixture.cloudflare, docker: fixture.docker,
      owner: 'operator', token: 'token-1',
    }), /invisible generation/);
    assert.ok(fixture.events.indexOf('cf:rollback') < fixture.events.indexOf('cf:abort-freeze'));
    assert.strictEqual(fixture.events.at(-1), 'docker:unlock');
  });

  it('keeps both durable locks when activation outcome is ambiguous', async function () {
    const fixture = await executorFixture({
      cloudflare: { activate: async () => { throw new Error('connection lost'); } },
    });

    await assert.rejects(fixture.executeStorageProfileMigration({
      plan: baseSource(), cloudflare: fixture.cloudflare, docker: fixture.docker,
      owner: 'operator', token: 'token-1',
    }), { code: 'MIGRATION_ACTIVATION_AMBIGUOUS' });
    assert.ok(!fixture.events.includes('cf:abort-freeze'));
    assert.ok(!fixture.events.includes('docker:unlock'));
  });
});
