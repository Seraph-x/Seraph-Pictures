const BARRIER_SCHEMA = `
  CREATE TABLE IF NOT EXISTS mutation_barrier_state (
    singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
    frozen INTEGER NOT NULL CHECK (frozen IN (0, 1)),
    generation TEXT,
    audience TEXT
  );
  INSERT OR IGNORE INTO mutation_barrier_state(singleton_id, frozen, generation, audience)
  VALUES (1, 0, NULL, NULL);
  CREATE TABLE IF NOT EXISTS mutation_leases (
    lease_id TEXT PRIMARY KEY,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_mutation_lease_expiry ON mutation_leases(expires_at);
`;

export class MutationBarrierRepository {
  constructor(storage) {
    this.storage = storage;
    this.sql = storage.sql;
    this.sql.exec(BARRIER_SCHEMA);
  }

  transaction(operation) {
    return this.storage.transaction(() => operation());
  }

  setState(state) {
    this.sql.exec(
      `UPDATE mutation_barrier_state SET frozen = ?, generation = ?, audience = ?
       WHERE singleton_id = 1`,
      state.frozen ? 1 : 0, state.generation, state.audience,
    );
  }

  readState() {
    const row = this.sql.exec(
      `SELECT frozen, generation, audience FROM mutation_barrier_state
       WHERE singleton_id = 1`,
    ).toArray()[0];
    return Object.freeze({
      frozen: Boolean(row?.frozen),
      generation: row?.generation || null,
      audience: row?.audience || null,
    });
  }

  isFrozen() {
    return this.readState().frozen;
  }

  insert(record) {
    this.sql.exec(
      'INSERT INTO mutation_leases(lease_id, expires_at) VALUES (?, ?)',
      record.leaseId, record.expiresAt,
    );
  }

  remove(leaseId) {
    const result = this.sql.exec('DELETE FROM mutation_leases WHERE lease_id = ?', leaseId);
    return Number(result.rowsWritten || 0) === 1;
  }

  count() {
    return Number(this.sql.exec(
      'SELECT COUNT(*) AS count FROM mutation_leases',
    ).toArray()[0]?.count || 0);
  }

  releaseExpired(now) {
    const result = this.sql.exec('DELETE FROM mutation_leases WHERE expires_at <= ?', now);
    return Number(result.rowsWritten || 0);
  }

  nextExpiry() {
    const row = this.sql.exec(
      'SELECT MIN(expires_at) AS expires_at FROM mutation_leases',
    ).toArray()[0];
    return Number.isFinite(row?.expires_at) ? row.expires_at : null;
  }
}
