const REFERENCE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS storage_references (
    operation_id TEXT PRIMARY KEY,
    storage_id TEXT NOT NULL,
    destination_storage_id TEXT,
    state TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    backend_write_started INTEGER NOT NULL CHECK (backend_write_started IN (0, 1)),
    last_action TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS storage_reference_profiles (
    operation_id TEXT NOT NULL,
    storage_id TEXT NOT NULL,
    PRIMARY KEY (operation_id, storage_id)
  );
  CREATE INDEX IF NOT EXISTS idx_storage_reference_profile
    ON storage_reference_profiles(storage_id);
  CREATE INDEX IF NOT EXISTS idx_storage_reference_expiry
    ON storage_references(state, expires_at);
  CREATE TABLE IF NOT EXISTS storage_profile_authority (
    singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
    generation TEXT,
    ledger_generation TEXT
  );
  INSERT OR IGNORE INTO storage_profile_authority(singleton_id, generation, ledger_generation)
  VALUES (1, NULL, NULL);
  CREATE TABLE IF NOT EXISTS storage_reference_staging_generations (
    generation TEXT PRIMARY KEY
  );
  CREATE TABLE IF NOT EXISTS storage_reference_staging (
    generation TEXT NOT NULL,
    operation_id TEXT NOT NULL,
    storage_id TEXT NOT NULL,
    PRIMARY KEY (generation, operation_id)
  );
`;

function mapRecord(row) {
  if (!row) return null;
  const destinationStorageId = row.destination_storage_id || null;
  return Object.freeze({
    operationId: row.operation_id,
    storageId: row.storage_id,
    destinationStorageId,
    state: row.state,
    expiresAt: Number(row.expires_at),
    backendWriteStarted: Boolean(row.backend_write_started),
    lastAction: row.last_action,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    protectedStorageIds: Object.freeze(destinationStorageId
      ? [row.storage_id, destinationStorageId]
      : [row.storage_id]),
  });
}

export class StorageReferenceRepository {
  constructor(storage) {
    this.storage = storage;
    this.sql = storage.sql;
    this.sql.exec(REFERENCE_SCHEMA);
  }

  transaction(operation) { return this.storage.transaction(operation); }

  read(operationId) {
    const row = this.sql.exec(
      'SELECT * FROM storage_references WHERE operation_id = ?', operationId,
    ).toArray()[0];
    return mapRecord(row);
  }

  write(record) {
    this.writeRecord(record);
    this.sql.exec('DELETE FROM storage_reference_profiles WHERE operation_id = ?', record.operationId);
    record.protectedStorageIds.forEach((storageId) => this.sql.exec(
      'INSERT INTO storage_reference_profiles(operation_id, storage_id) VALUES (?, ?)',
      record.operationId, storageId,
    ));
  }

  writeRecord(record) {
    this.sql.exec(
      `INSERT OR REPLACE INTO storage_references
       (operation_id, storage_id, destination_storage_id, state, expires_at,
        backend_write_started, last_action, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      record.operationId, record.storageId, record.destinationStorageId, record.state,
      record.expiresAt, record.backendWriteStarted ? 1 : 0, record.lastAction,
      record.createdAt, record.updatedAt,
    );
  }

  remove(operationId) {
    this.sql.exec('DELETE FROM storage_reference_profiles WHERE operation_id = ?', operationId);
    const result = this.sql.exec('DELETE FROM storage_references WHERE operation_id = ?', operationId);
    return Number(result.rowsWritten || 0) === 1;
  }

  listExpiredReserved(now) {
    return this.sql.exec(
      `SELECT * FROM storage_references
       WHERE state = 'reserved' AND backend_write_started = 0 AND expires_at <= ?`, now,
    ).toArray().map(mapRecord);
  }

  nextExpiry() {
    const row = this.sql.exec(
      `SELECT MIN(expires_at) AS expires_at FROM storage_references
       WHERE state = 'reserved' AND backend_write_started = 0`,
    ).toArray()[0];
    return Number.isFinite(row?.expires_at) ? Number(row.expires_at) : null;
  }

  count(storageId) {
    const row = this.sql.exec(
      'SELECT COUNT(*) AS count FROM storage_reference_profiles WHERE storage_id = ?', storageId,
    ).toArray()[0];
    return Number(row?.count || 0);
  }

  readAuthority() {
    const row = this.sql.exec(
      'SELECT generation, ledger_generation FROM storage_profile_authority WHERE singleton_id = 1',
    ).toArray()[0];
    if (!row?.generation) return null;
    return Object.freeze({ generation: row.generation, ledgerGeneration: row.ledger_generation });
  }

  writeAuthority(authority) {
    this.sql.exec(
      `UPDATE storage_profile_authority SET generation = ?, ledger_generation = ?
       WHERE singleton_id = 1`,
      authority.generation, authority.ledgerGeneration,
    );
  }

  resetStagedLedger(generation) {
    this.sql.exec('DELETE FROM storage_reference_staging WHERE generation = ?', generation);
    this.sql.exec(
      'INSERT OR IGNORE INTO storage_reference_staging_generations(generation) VALUES (?)',
      generation,
    );
  }

  stageLedger(generation, references) {
    references.forEach((reference) => this.sql.exec(
      `INSERT OR REPLACE INTO storage_reference_staging
       (generation, operation_id, storage_id) VALUES (?, ?, ?)`,
      generation, reference.operationId, reference.storageId,
    ));
  }

  hasStagedLedger(generation) {
    return Boolean(this.sql.exec(
      'SELECT generation FROM storage_reference_staging_generations WHERE generation = ?',
      generation,
    ).toArray()[0]);
  }

  readStagedReference(generation, operationId) {
    const row = this.sql.exec(
      `SELECT operation_id, storage_id FROM storage_reference_staging
       WHERE generation = ? AND operation_id = ?`, generation, operationId,
    ).toArray()[0];
    return row ? Object.freeze({
      operationId: row.operation_id, storageId: row.storage_id,
    }) : null;
  }

  readStagedLedger(generation) {
    return this.sql.exec(
      `SELECT operation_id, storage_id FROM storage_reference_staging
       WHERE generation = ? ORDER BY operation_id`, generation,
    ).toArray().map((row) => Object.freeze({
      operationId: row.operation_id, storageId: row.storage_id,
    }));
  }

  clearStagedLedger(generation) {
    this.sql.exec('DELETE FROM storage_reference_staging WHERE generation = ?', generation);
    this.sql.exec(
      'DELETE FROM storage_reference_staging_generations WHERE generation = ?', generation,
    );
  }
}
