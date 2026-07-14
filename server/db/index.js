const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

function migrateChunkUploadReferences(db) {
  const references = db.prepare('PRAGMA foreign_key_list(chunk_uploads)').all();
  if (references.some((item) => item.from === 'storage_config_id')) return;
  const orphan = db.prepare(`SELECT COUNT(1) AS count FROM chunk_uploads AS chunks
    LEFT JOIN storage_configs AS profiles ON profiles.id = chunks.storage_config_id
    WHERE chunks.storage_config_id IS NOT NULL AND profiles.id IS NULL`).get();
  if (Number(orphan?.count || 0) > 0) {
    const error = new Error('Chunk uploads contain unknown storage profiles.');
    error.code = 'STORAGE_PROFILE_INTEGRITY_ERROR';
    throw error;
  }
  db.exec(`PRAGMA foreign_keys = OFF;
    BEGIN;
    ALTER TABLE chunk_uploads RENAME TO chunk_uploads_legacy;
    CREATE TABLE chunk_uploads (
      upload_id TEXT PRIMARY KEY, file_name TEXT NOT NULL, file_size INTEGER NOT NULL,
      file_type TEXT, total_chunks INTEGER NOT NULL, chunk_size INTEGER NOT NULL DEFAULT 0,
      received_bytes INTEGER NOT NULL DEFAULT 0, storage_mode TEXT, storage_config_id TEXT,
      upload_source TEXT NOT NULL DEFAULT 'image-host', visibility TEXT NOT NULL DEFAULT 'public',
      folder_path TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
      FOREIGN KEY(storage_config_id) REFERENCES storage_configs(id) ON DELETE RESTRICT
    );
    INSERT INTO chunk_uploads SELECT * FROM chunk_uploads_legacy;
    DROP TABLE chunk_uploads_legacy;
    CREATE INDEX idx_chunk_uploads_expires_at ON chunk_uploads(expires_at);
    COMMIT;
    PRAGMA foreign_keys = ON;`);
}

function executeStatement(stmt, method, params) {
  if (params == null) {
    return stmt[method]();
  }
  if (Array.isArray(params)) {
    return stmt[method](...params);
  }
  return stmt[method](params);
}

function initDatabase(dbPath) {
  const fullPath = path.resolve(dbPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });

  const db = new DatabaseSync(fullPath);
  const schemaPath = path.resolve(__dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  db.exec(schema);
  migrateChunkUploadReferences(db);

  return db;
}

function run(db, sql, params) {
  const stmt = db.prepare(sql);
  return executeStatement(stmt, 'run', params);
}

function get(db, sql, params) {
  const stmt = db.prepare(sql);
  return executeStatement(stmt, 'get', params);
}

function all(db, sql, params) {
  const stmt = db.prepare(sql);
  return executeStatement(stmt, 'all', params);
}

function transaction(db, callback) {
  db.exec('BEGIN');
  try {
    const result = callback();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function cleanupExpiredState(db) {
  const now = Date.now();
  run(db, 'DELETE FROM sessions WHERE expires_at <= ?', [now]);
  run(db, 'DELETE FROM chunk_uploads WHERE expires_at <= ?', [now]);
  run(db, 'DELETE FROM login_failures WHERE window_expires_at <= ?', [now]);
  run(db, 'DELETE FROM private_shares WHERE expires_at <= ?', [now]);
  run(db, 'DELETE FROM share_range_leases WHERE expires_at <= ?', [now]);
}

module.exports = {
  initDatabase,
  run,
  get,
  all,
  transaction,
  cleanupExpiredState,
};
