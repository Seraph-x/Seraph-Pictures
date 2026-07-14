const { get, run } = require('../../../db');

const DEFAULT_REFERENCE_STATE = 'reserved';

class StorageReferenceRepository {
  constructor({ db, clock = Date }) {
    this.db = db;
    this.clock = clock;
  }

  countForProfile(storageId) {
    const files = get(this.db, 'SELECT COUNT(1) AS count FROM files WHERE storage_config_id = ?', [storageId]);
    const chunks = get(this.db, `SELECT COUNT(1) AS count FROM chunk_uploads
      WHERE storage_config_id = ?`, [storageId]);
    const writes = get(this.db, `SELECT COUNT(1) AS count FROM storage_write_references
      WHERE storage_config_id = ?`, [storageId]);
    return Number(files?.count || 0) + Number(chunks?.count || 0) + Number(writes?.count || 0);
  }

  reserve({ operationId, storageId, state = DEFAULT_REFERENCE_STATE }) {
    const now = this.clock.now();
    run(this.db, `INSERT INTO storage_write_references(
      operation_id, storage_config_id, state, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(operation_id) DO UPDATE SET
      storage_config_id = excluded.storage_config_id,
      state = excluded.state,
      updated_at = excluded.updated_at`, [operationId, storageId, state, now, now]);
  }

  release(operationId) {
    return run(this.db, 'DELETE FROM storage_write_references WHERE operation_id = ?', [operationId]);
  }
}

module.exports = { StorageReferenceRepository };
