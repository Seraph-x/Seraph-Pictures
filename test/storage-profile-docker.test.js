const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { initDatabase, get, run } = require('../server/db');
const { StorageConfigRepository } = require('../server/lib/repos/storage-config-repo');

const APP_CONFIG = Object.freeze({ configEncryptionKey: 'docker-profile-test-key' });

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seraph-storage-profile-'));
  const db = initDatabase(path.join(root, 'profiles.db'));
  return { db, repo: new StorageConfigRepository(db, APP_CONFIG), root };
}

function telegram(name, options = {}) {
  return {
    name,
    type: 'telegram',
    config: { botToken: `${name}-token`, chatId: `${name}-chat` },
    enabled: options.enabled !== false,
    isDefault: options.isDefault === true,
  };
}

describe('Docker storage profile repository', function () {
  let fixture;

  beforeEach(function () { fixture = createFixture(); });
  afterEach(function () { fixture.db.close(); fs.rmSync(fixture.root, { recursive: true }); });

  it('enforces one enabled default independently per type', function () {
    const first = fixture.repo.create(telegram('first'));
    const second = fixture.repo.create(telegram('second'));
    const github = fixture.repo.create({
      name: 'github', type: 'github', config: { repo: 'u/r', token: 'token' },
    });

    assert.strictEqual(first.isDefault, true);
    assert.strictEqual(second.isDefault, false);
    assert.strictEqual(github.isDefault, true);
    fixture.repo.setDefault(second.id);
    const defaults = fixture.repo.list(true).filter((item) => item.isDefault);
    assert.deepStrictEqual(defaults.map((item) => item.id).sort(), [github.id, second.id].sort());
    assert.throws(() => fixture.repo.update(second.id, { enabled: false }), {
      code: 'STORAGE_DEFAULT_LOCKED',
    });
  });

  it('uses a partial unique index for per-type defaults', function () {
    const index = get(fixture.db, `SELECT sql FROM sqlite_master
      WHERE type = 'index' AND name = 'ux_storage_default_per_type'`);
    assert.match(index.sql, /UNIQUE INDEX/i);
    assert.match(index.sql, /WHERE is_default = 1/i);
  });

  it('preserves IDs and replaces config when a profile type changes', function () {
    const source = fixture.repo.create(telegram('source'));
    const replacement = fixture.repo.create(telegram('replacement'));
    fixture.repo.setDefault(replacement.id);
    const updated = fixture.repo.update(source.id, {
      type: 'github', name: 'moved', config: { repo: 'u/r', token: 'new-token' },
    });

    assert.strictEqual(updated.id, source.id);
    assert.strictEqual(updated.type, 'github');
    assert.deepStrictEqual(updated.config, { repo: 'u/r', token: 'new-token' });
    assert.strictEqual(updated.isDefault, true);
  });

  it('blocks delete and type changes for every durable reference state', function () {
    const profile = fixture.repo.create(telegram('referenced'));
    fixture.repo.reserveReference({ operationId: 'op-1', storageId: profile.id });

    assert.throws(() => fixture.repo.delete(profile.id), { code: 'STORAGE_PROFILE_IN_USE' });
    assert.throws(() => fixture.repo.update(profile.id, {
      type: 'github', config: { repo: 'u/r', token: 'token' },
    }), { code: 'STORAGE_PROFILE_IN_USE' });
    fixture.repo.releaseReference('op-1');
  });

  it('counts active chunk uploads as profile references', function () {
    const profile = fixture.repo.create(telegram('chunked'));
    run(fixture.db, `INSERT INTO chunk_uploads(
      upload_id, file_name, file_size, total_chunks, storage_config_id, created_at, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`, ['up-1', 'a.bin', 1, 1, profile.id, Date.now(), Date.now() + 60000]);

    assert.throws(() => fixture.repo.delete(profile.id), { code: 'STORAGE_PROFILE_IN_USE' });
  });

  it('fails profile mutations while the migration lock is owned', function () {
    fixture.repo.acquireMigrationLock({ owner: 'migration', token: 'token-1' });
    assert.throws(() => fixture.repo.create(telegram('blocked')), {
      code: 'STORAGE_MIGRATION_FAILED',
    });
    assert.throws(
      () => fixture.repo.releaseMigrationLock({ owner: 'other', token: 'wrong' }),
      { code: 'STORAGE_MIGRATION_FAILED' },
    );
    fixture.repo.releaseMigrationLock({ owner: 'migration', token: 'token-1' });
    assert.strictEqual(fixture.repo.create(telegram('allowed')).isDefault, true);
  });
});
