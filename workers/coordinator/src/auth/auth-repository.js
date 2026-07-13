const CREATE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS auth_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    username TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    iterations INTEGER NOT NULL,
    cred_version INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS auth_sessions (
    token TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    cred_version INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS auth_passkeys (
    id TEXT PRIMARY KEY,
    record_json TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS auth_challenges (
    kind TEXT PRIMARY KEY,
    challenge TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS auth_metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`;

function mapState(row) {
  if (!row) return null;
  return Object.freeze({
    initialized: true,
    username: row.username,
    passwordHash: row.password_hash,
    salt: row.salt,
    iterations: row.iterations,
    credVersion: row.cred_version,
  });
}

function mapSession(row) {
  if (!row) return null;
  return Object.freeze({
    token: row.token,
    username: row.username,
    credVersion: row.cred_version,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  });
}

export class AuthRepository {
  constructor(storage) {
    this.storage = storage;
    this.sql = storage.sql;
    this.sql.exec(CREATE_SCHEMA);
  }

  transaction(operation) {
    return this.storage.transaction(() => operation());
  }

  readAuthState() {
    return mapState(this.sql.exec('SELECT * FROM auth_state WHERE id = 1').toArray()[0]);
  }

  initializeAuth(state) {
    this.sql.exec(
      'INSERT INTO auth_state VALUES (1, ?, ?, ?, ?, ?)',
      state.username, state.passwordHash, state.salt, state.iterations, state.credVersion
    );
  }

  updateAuth(state) {
    this.sql.exec(
      'UPDATE auth_state SET username = ?, password_hash = ?, salt = ?, iterations = ?, cred_version = ? WHERE id = 1',
      state.username, state.passwordHash, state.salt, state.iterations, state.credVersion
    );
  }

  readSession(token) {
    return mapSession(this.sql.exec('SELECT * FROM auth_sessions WHERE token = ?', token).toArray()[0]);
  }

  writeSession(session) {
    this.sql.exec(
      'INSERT INTO auth_sessions VALUES (?, ?, ?, ?, ?)',
      session.token, session.username, session.credVersion, session.createdAt, session.expiresAt
    );
  }

  deleteSession(token) {
    this.sql.exec('DELETE FROM auth_sessions WHERE token = ?', token);
  }

  deleteAllSessions() {
    this.sql.exec('DELETE FROM auth_sessions');
  }

  listPasskeys() {
    return this.sql.exec('SELECT record_json FROM auth_passkeys ORDER BY id').toArray()
      .map((row) => Object.freeze(JSON.parse(row.record_json)));
  }

  readPasskey(id) {
    const row = this.sql.exec('SELECT record_json FROM auth_passkeys WHERE id = ?', id).toArray()[0];
    return row ? Object.freeze(JSON.parse(row.record_json)) : null;
  }

  writePasskey(record) {
    this.sql.exec(
      'INSERT OR REPLACE INTO auth_passkeys (id, record_json) VALUES (?, ?)',
      record.id, JSON.stringify(record)
    );
  }

  deletePasskey(id) {
    const exists = Boolean(this.readPasskey(id));
    if (exists) this.sql.exec('DELETE FROM auth_passkeys WHERE id = ?', id);
    return exists;
  }

  writeChallenge(record) {
    this.sql.exec(
      'INSERT OR REPLACE INTO auth_challenges (kind, challenge, expires_at) VALUES (?, ?, ?)',
      record.kind, record.challenge, record.expiresAt
    );
  }

  takeChallenge(kind) {
    const row = this.sql.exec('SELECT * FROM auth_challenges WHERE kind = ?', kind).toArray()[0];
    if (row) this.sql.exec('DELETE FROM auth_challenges WHERE kind = ?', kind);
    return row ? Object.freeze({ kind: row.kind, challenge: row.challenge, expiresAt: row.expires_at }) : null;
  }

  readMetadata(key) {
    return this.sql.exec('SELECT value FROM auth_metadata WHERE key = ?', key).toArray()[0]?.value || null;
  }

  writeMetadata(key, value) {
    this.sql.exec('INSERT OR REPLACE INTO auth_metadata (key, value) VALUES (?, ?)', key, value);
  }
}
