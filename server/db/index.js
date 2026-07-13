const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

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
