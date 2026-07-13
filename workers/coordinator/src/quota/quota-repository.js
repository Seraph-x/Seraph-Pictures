const QUOTA_SCHEMA = `
  CREATE TABLE IF NOT EXISTS guest_upload_reservations (
    reservation_id TEXT PRIMARY KEY,
    subject_hash TEXT NOT NULL,
    day_key TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('reserved', 'completed')),
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_guest_reservation_day
  ON guest_upload_reservations(subject_hash, day_key);
  CREATE INDEX IF NOT EXISTS idx_guest_reservation_burst
  ON guest_upload_reservations(subject_hash, created_at);
  CREATE INDEX IF NOT EXISTS idx_guest_reservation_expiry
  ON guest_upload_reservations(state, expires_at);
`;

export class GuestQuotaRepository {
  constructor(storage) {
    this.storage = storage;
    this.sql = storage.sql;
    this.sql.exec(QUOTA_SCHEMA);
  }

  transaction(operation) {
    return this.storage.transaction(() => operation());
  }

  releaseExpired(nowMs) {
    const result = this.sql.exec(
      `DELETE FROM guest_upload_reservations
       WHERE state = 'reserved' AND expires_at <= ?`, nowMs,
    );
    const today = new Date(nowMs).toISOString().slice(0, 10);
    this.sql.exec(
      `DELETE FROM guest_upload_reservations
       WHERE state = 'completed' AND day_key < ?`, today,
    );
    return Number(result.rowsWritten || 0);
  }

  countDay(subjectHash, dayKey) {
    return Number(this.sql.exec(
      `SELECT COUNT(*) AS count FROM guest_upload_reservations
       WHERE subject_hash = ? AND day_key = ?`, subjectHash, dayKey,
    ).toArray()[0]?.count || 0);
  }

  countBurst(subjectHash, sinceMs) {
    return Number(this.sql.exec(
      `SELECT COUNT(*) AS count FROM guest_upload_reservations
       WHERE subject_hash = ? AND created_at > ?`, subjectHash, sinceMs,
    ).toArray()[0]?.count || 0);
  }

  insert(record) {
    this.sql.exec(
      `INSERT INTO guest_upload_reservations
       VALUES (?, ?, ?, ?, ?, ?)`,
      record.reservationId, record.subjectHash, record.dayKey,
      record.state, record.createdAt, record.expiresAt,
    );
  }

  complete(reservationId) {
    const result = this.sql.exec(
      `UPDATE guest_upload_reservations SET state = 'completed'
       WHERE reservation_id = ? AND state = 'reserved'`, reservationId,
    );
    return Number(result.rowsWritten || 0) === 1;
  }

  read(reservationId) {
    return this.sql.exec(
      `SELECT reservation_id AS reservationId, state
       FROM guest_upload_reservations WHERE reservation_id = ?`, reservationId,
    ).toArray()[0] || null;
  }

  cancel(reservationId) {
    const result = this.sql.exec(
      `DELETE FROM guest_upload_reservations
       WHERE reservation_id = ? AND state = 'reserved'`, reservationId,
    );
    return Number(result.rowsWritten || 0) === 1;
  }

  nextExpiry() {
    const row = this.sql.exec(
      `SELECT MIN(expires_at) AS expires_at FROM guest_upload_reservations
       WHERE state = 'reserved'`,
    ).toArray()[0];
    return Number.isFinite(row?.expires_at) ? row.expires_at : null;
  }
}
