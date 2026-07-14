const { get, run } = require('../../../db');
const { StoragePolicyError } = require('../../../../shared/storage/profile-policy.cjs');

const LOCK_ID = 1;

class StorageMigrationLockRepository {
  constructor({ db, clock = Date }) {
    this.db = db;
    this.clock = clock;
  }

  current() {
    return get(this.db, 'SELECT * FROM storage_migration_lock WHERE singleton_id = ?', [LOCK_ID]);
  }

  assertUnlocked() {
    if (this.current()) throw new StoragePolicyError('STORAGE_MIGRATION_FAILED');
  }

  acquire({ owner, token }) {
    const current = this.current();
    if (current?.owner === owner && current?.token === token) return Object.freeze({ owner, token });
    if (current) throw new StoragePolicyError('STORAGE_MIGRATION_FAILED');
    run(this.db, `INSERT INTO storage_migration_lock(singleton_id, owner, token, acquired_at)
      VALUES (?, ?, ?, ?)`, [LOCK_ID, owner, token, this.clock.now()]);
    return Object.freeze({ owner, token });
  }

  release({ owner, token }) {
    const current = this.current();
    if (!current || current.owner !== owner || current.token !== token) {
      throw new StoragePolicyError('STORAGE_MIGRATION_FAILED');
    }
    run(this.db, `DELETE FROM storage_migration_lock
      WHERE singleton_id = ? AND owner = ? AND token = ?`, [LOCK_ID, owner, token]);
  }
}

module.exports = { StorageMigrationLockRepository };
