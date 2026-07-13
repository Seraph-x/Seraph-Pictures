const CREATE_CONFIG_SCHEMA = `
  CREATE TABLE IF NOT EXISTS config_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    committed_version INTEGER NOT NULL,
    committed_digest TEXT,
    pending_version INTEGER,
    pending_digest TEXT,
    pending_started_at INTEGER
  );
`;

function mapState(row) {
  if (!row) return null;
  return Object.freeze({
    committedVersion: row.committed_version,
    committedDigest: row.committed_digest,
    pendingVersion: row.pending_version,
    pendingDigest: row.pending_digest,
    pendingStartedAt: row.pending_started_at,
  });
}

export class ConfigStateRepository {
  constructor(storage) {
    this.storage = storage;
    this.sql = storage.sql;
    this.sql.exec(CREATE_CONFIG_SCHEMA);
  }

  transaction(operation) {
    return this.storage.transaction(() => operation());
  }

  readState() {
    return mapState(this.sql.exec('SELECT * FROM config_state WHERE id = 1').toArray()[0]);
  }

  writeState(state) {
    this.sql.exec(
      `INSERT OR REPLACE INTO config_state
       (id, committed_version, committed_digest, pending_version, pending_digest, pending_started_at)
       VALUES (1, ?, ?, ?, ?, ?)`,
      state.committedVersion,
      state.committedDigest,
      state.pendingVersion,
      state.pendingDigest,
      state.pendingStartedAt,
    );
  }
}
