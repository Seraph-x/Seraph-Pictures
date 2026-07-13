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

class GuestQuotaRepository {
  constructor(db) {
    this.db = db;
    db.exec(QUOTA_SCHEMA);
  }

  transaction(operation) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  releaseExpired(nowMs) {
    const result = this.db.prepare(
      `DELETE FROM guest_upload_reservations
       WHERE state = 'reserved' AND expires_at <= ?`,
    ).run(nowMs);
    const today = new Date(nowMs).toISOString().slice(0, 10);
    this.db.prepare(
      `DELETE FROM guest_upload_reservations
       WHERE state = 'completed' AND day_key < ?`,
    ).run(today);
    return Number(result.changes || 0);
  }

  countDay(subjectHash, dayKey) {
    const row = this.db.prepare(
      `SELECT COUNT(*) AS count FROM guest_upload_reservations
       WHERE subject_hash = ? AND day_key = ?`,
    ).get(subjectHash, dayKey);
    return Number(row?.count || 0);
  }

  countBurst(subjectHash, sinceMs) {
    const row = this.db.prepare(
      `SELECT COUNT(*) AS count FROM guest_upload_reservations
       WHERE subject_hash = ? AND created_at > ?`,
    ).get(subjectHash, sinceMs);
    return Number(row?.count || 0);
  }

  insert(record) {
    this.db.prepare(
      `INSERT INTO guest_upload_reservations
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      record.reservationId, record.subjectHash, record.dayKey,
      record.state, record.createdAt, record.expiresAt,
    );
  }

  complete(reservationId) {
    const result = this.db.prepare(
      `UPDATE guest_upload_reservations SET state = 'completed'
       WHERE reservation_id = ? AND state = 'reserved'`,
    ).run(reservationId);
    return Number(result.changes || 0) === 1;
  }

  read(reservationId) {
    return this.db.prepare(
      `SELECT reservation_id AS reservationId, state
       FROM guest_upload_reservations WHERE reservation_id = ?`,
    ).get(reservationId) || null;
  }

  cancel(reservationId) {
    const result = this.db.prepare(
      `DELETE FROM guest_upload_reservations
       WHERE reservation_id = ? AND state = 'reserved'`,
    ).run(reservationId);
    return Number(result.changes || 0) === 1;
  }

  nextExpiry() {
    const row = this.db.prepare(
      `SELECT MIN(expires_at) AS expires_at FROM guest_upload_reservations
       WHERE state = 'reserved'`,
    ).get();
    return Number.isFinite(row?.expires_at) ? row.expires_at : null;
  }
}

module.exports = { GuestQuotaRepository };
