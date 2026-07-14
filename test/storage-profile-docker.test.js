const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { initDatabase, get, run } = require('../server/db');
const { StorageConfigRepository } = require('../server/lib/repos/storage-config-repo');

const APP_CONFIG = Object.freeze({ configEncryptionKey: 'docker-profile-test-key' });

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seraph-storage-profile-'));
  const db = initDatabase(path.join(root, 'profiles.db'));
  return { db, repo: new StorageConfigRepository(db, APP_CONFIG), root };
}

function telegram(name, options = {}) {
  const profile = {
    name,
    type: 'telegram',
    config: { botToken: `${name}-token`, chatId: `${name}-chat` },
    enabled: options.enabled !== false,
  };
  if (Object.hasOwn(options, 'isDefault')) profile.isDefault = options.isDefault;
  return profile;
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

  it('upgrades the legacy chunk table without losing valid references', function () {
    const legacyPath = path.join(fixture.root, 'legacy.db');
    const legacy = new DatabaseSync(legacyPath);
    legacy.exec(`CREATE TABLE storage_configs (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL,
      encrypted_payload TEXT NOT NULL, is_default INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1, metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE chunk_uploads (
      upload_id TEXT PRIMARY KEY, file_name TEXT NOT NULL, file_size INTEGER NOT NULL,
      file_type TEXT, total_chunks INTEGER NOT NULL, chunk_size INTEGER NOT NULL DEFAULT 0,
      received_bytes INTEGER NOT NULL DEFAULT 0, storage_mode TEXT, storage_config_id TEXT,
      upload_source TEXT NOT NULL DEFAULT 'image-host', visibility TEXT NOT NULL DEFAULT 'public',
      folder_path TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
    );
    INSERT INTO storage_configs VALUES ('profile', 'P', 'telegram', '{}', 1, 1, '{}', 1, 1);
    INSERT INTO chunk_uploads(upload_id, file_name, file_size, total_chunks,
      storage_config_id, created_at, expires_at) VALUES ('upload', 'a', 1, 1, 'profile', 1, 2);`);
    legacy.close();

    const upgraded = initDatabase(legacyPath);
    const keys = upgraded.prepare('PRAGMA foreign_key_list(chunk_uploads)').all();
    assert.ok(keys.some((item) => item.from === 'storage_config_id'));
    assert.strictEqual(get(upgraded, 'SELECT storage_config_id FROM chunk_uploads').storage_config_id, 'profile');
    upgraded.close();
  });

  it('rejects an explicit non-default first profile', function () {
    assert.throws(() => fixture.repo.create(telegram('invalid', { isDefault: false })), {
      code: 'STORAGE_DEFAULT_REQUIRED',
    });
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
    const other = fixture.repo.create(telegram('other'));
    assert.throws(
      () => fixture.repo.reserveReference({ operationId: 'op-1', storageId: other.id }),
      { code: 'STORAGE_PROFILE_INTEGRITY_ERROR' },
    );

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
    assert.throws(() => run(fixture.db, `INSERT INTO chunk_uploads(
      upload_id, file_name, file_size, total_chunks, storage_config_id, created_at, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`, [
      'orphan', 'b.bin', 1, 1, 'missing-profile', Date.now(), Date.now() + 60000,
    ]), /FOREIGN KEY/);
  });

  it('fails profile mutations while the migration lock is owned', function () {
    assert.throws(() => fixture.repo.acquireMigrationLock({ owner: '', token: '' }), {
      code: 'STORAGE_MIGRATION_FAILED',
    });
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

  it('blocks new write reservations while the migration lock is owned', function () {
    const profile = fixture.repo.create(telegram('locked-write'));
    fixture.repo.acquireMigrationLock({ owner: 'migration', token: 'token-1' });

    assert.throws(
      () => fixture.repo.reserveReference({ operationId: 'op-locked', storageId: profile.id }),
      { code: 'STORAGE_MIGRATION_FAILED' },
    );
    assert.strictEqual(get(fixture.db, `SELECT operation_id FROM storage_write_references
      WHERE operation_id = ?`, ['op-locked']), undefined);
  });

  it('blocks chunk reference creation while the migration lock is owned', function () {
    let inserted = false;
    fixture.repo.acquireMigrationLock({ owner: 'migration', token: 'token-1' });
    assert.throws(() => fixture.repo.createChunkReference(() => {
      inserted = true;
    }), { code: 'STORAGE_MIGRATION_FAILED' });
    assert.strictEqual(inserted, false);
  });

  it('commits metadata and releases its write reservation atomically', function () {
    const profile = fixture.repo.create(telegram('atomic-write'));
    fixture.repo.reserveReference({ operationId: 'op-atomic', storageId: profile.id });
    fixture.repo.reserveReference({
      operationId: 'op-atomic', storageId: profile.id, state: 'committing',
    });

    assert.throws(() => fixture.repo.commitReference('op-atomic', () => {
      run(fixture.db, `INSERT INTO files(
        id, storage_config_id, storage_type, storage_key, file_name,
        file_size, mime_type, visibility, upload_source, access_version, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
        'file-atomic', profile.id, profile.type, 'key', 'a.png', 1, 'image/png',
        'public', 'image-host', 1, 1, 1,
      ]);
      throw new Error('metadata failed');
    }), /metadata failed/);

    assert.strictEqual(get(fixture.db, 'SELECT id FROM files WHERE id = ?', ['file-atomic']), undefined);
    assert.strictEqual(get(fixture.db, `SELECT state FROM storage_write_references
      WHERE operation_id = ?`, ['op-atomic']).state, 'committing');
  });

  it('rejects metadata commit before the reference enters committing state', function () {
    const profile = fixture.repo.create(telegram('premature-write'));
    fixture.repo.reserveReference({ operationId: 'op-premature', storageId: profile.id });

    assert.throws(
      () => fixture.repo.commitReference('op-premature', () => 'metadata'),
      { code: 'STORAGE_PROFILE_INTEGRITY_ERROR' },
    );
    assert.strictEqual(get(fixture.db, `SELECT state FROM storage_write_references
      WHERE operation_id = ?`, ['op-premature']).state, 'reserved');
  });
});
