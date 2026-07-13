const UPLOAD_SCHEMA = `
  CREATE TABLE IF NOT EXISTS multipart_upload_state (
    singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
    record_json TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS multipart_quota_reservations (
    upload_id TEXT PRIMARY KEY,
    bytes INTEGER NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('reserved', 'consumed', 'cancelled')),
    expires_at INTEGER NOT NULL,
    operation_id TEXT NOT NULL
  );
`;

function quotaError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

export class UploadRepository {
  constructor(storage) {
    this.sql = storage.sql;
    this.sql.exec(UPLOAD_SCHEMA);
  }

  read() {
    const row = this.sql.exec(
      'SELECT record_json FROM multipart_upload_state WHERE singleton_id = 1',
    ).toArray()[0];
    return row ? JSON.parse(row.record_json) : null;
  }

  write(record) {
    this.sql.exec(
      `INSERT INTO multipart_upload_state(singleton_id, record_json) VALUES (1, ?)
       ON CONFLICT(singleton_id) DO UPDATE SET record_json = excluded.record_json`,
      JSON.stringify(record),
    );
  }

  readQuota(uploadId) {
    return this.sql.exec(
      `SELECT upload_id AS uploadId, bytes, state, expires_at AS expiresAt,
       operation_id AS operationId FROM multipart_quota_reservations WHERE upload_id = ?`,
      uploadId,
    ).toArray()[0] || null;
  }

  reserveQuota(input) {
    const existing = this.readQuota(input.uploadId);
    if (existing) {
      if (existing.bytes !== input.bytes) throw quotaError('MULTIPART_QUOTA_CONFLICT');
      return existing;
    }
    this.sql.exec(
      'INSERT INTO multipart_quota_reservations VALUES (?, ?, ?, ?, ?)',
      input.uploadId, input.bytes, 'reserved', input.expiresAt, input.operationId,
    );
    return this.readQuota(input.uploadId);
  }

  transitionQuota(input, target) {
    const existing = this.readQuota(input.uploadId);
    if (!existing || existing.bytes !== input.bytes) throw quotaError('MULTIPART_QUOTA_INVALID');
    if (existing.state === target) return existing;
    const canCancelConsumed = target === 'cancelled' && existing.state === 'consumed';
    if (existing.state !== 'reserved' && !canCancelConsumed) {
      throw quotaError('MULTIPART_QUOTA_CONFLICT');
    }
    this.sql.exec(
      `UPDATE multipart_quota_reservations SET state = ?, operation_id = ?
       WHERE upload_id = ?`, target, input.operationId, input.uploadId,
    );
    return this.readQuota(input.uploadId);
  }
}
