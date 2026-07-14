const { all, get } = require('../../../db');

class StorageConfigQueryRepository {
  constructor({ db, mapRow }) {
    this.db = db;
    this.mapRow = mapRow;
  }

  list(includeSecrets = false) {
    const rows = all(this.db, `SELECT * FROM storage_configs
      ORDER BY type ASC, is_default DESC, created_at ASC`);
    return Object.freeze(rows.map((row) => this.mapRow(row, includeSecrets)));
  }

  getById(id, includeSecrets = true) {
    const row = get(this.db, 'SELECT * FROM storage_configs WHERE id = ?', [id]);
    return this.mapRow(row, includeSecrets);
  }

  findEnabledByType(type) {
    const rows = all(this.db, `SELECT * FROM storage_configs
      WHERE type = ? AND enabled = 1
      ORDER BY is_default DESC, created_at ASC`, [type]);
    return Object.freeze(rows.map((row) => this.mapRow(row, true)));
  }

  getDefaultByType(type) {
    const row = get(this.db, `SELECT * FROM storage_configs
      WHERE type = ? AND is_default = 1 AND enabled = 1`, [type]);
    return this.mapRow(row, true);
  }
}

module.exports = { StorageConfigQueryRepository };
