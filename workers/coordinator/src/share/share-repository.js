const SHARE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS private_shares (
    share_id TEXT PRIMARY KEY,
    file_id TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    access_version INTEGER NOT NULL,
    revoked INTEGER NOT NULL,
    password_hash TEXT,
    max_downloads INTEGER,
    download_count INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_private_shares_expiry
  ON private_shares(expires_at);
  CREATE TABLE IF NOT EXISTS share_range_leases (
    lease_id TEXT PRIMARY KEY,
    share_id TEXT NOT NULL,
    token_hash TEXT NOT NULL,
    next_offset INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_share_range_leases_expiry
  ON share_range_leases(expires_at);
  CREATE INDEX IF NOT EXISTS idx_share_range_leases_share
  ON share_range_leases(share_id);
`;

function mapRecord(row) {
  if (!row) return null;
  return Object.freeze({
    shareId: row.share_id,
    fileId: row.file_id,
    expiresAt: row.expires_at,
    accessVersion: row.access_version,
    revoked: Boolean(row.revoked),
    passwordHash: row.password_hash || null,
    maxDownloads: row.max_downloads ?? null,
    downloadCount: row.download_count,
    createdAt: row.created_at,
  });
}

export class ShareRepository {
  constructor(storage) {
    this.storage = storage;
    this.sql = storage.sql;
    this.sql.exec(SHARE_SCHEMA);
  }

  transaction(operation) {
    return this.storage.transaction(() => operation());
  }

  insert(record) {
    this.sql.exec(
      `INSERT INTO private_shares
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      record.shareId,
      record.fileId,
      record.expiresAt,
      record.accessVersion,
      record.revoked ? 1 : 0,
      record.passwordHash,
      record.maxDownloads,
      record.downloadCount,
      record.createdAt,
    );
  }

  read(shareId) {
    const row = this.sql.exec(
      'SELECT * FROM private_shares WHERE share_id = ?',
      shareId,
    ).toArray()[0];
    return mapRecord(row);
  }

  increment(shareId) {
    this.sql.exec(
      `UPDATE private_shares
       SET download_count = download_count + 1
       WHERE share_id = ?`,
      shareId,
    );
  }

  deleteExpired(nowMs) {
    this.sql.exec(
      'DELETE FROM private_shares WHERE expires_at <= ?',
      nowMs,
    );
    this.sql.exec(
      'DELETE FROM share_range_leases WHERE expires_at <= ?',
      nowMs,
    );
  }

  readLease(shareId, leaseId) {
    return this.sql.exec(
      `SELECT * FROM share_range_leases
       WHERE share_id = ? AND lease_id = ?`, shareId, leaseId,
    ).toArray()[0] || null;
  }

  putLease(lease) {
    this.sql.exec(
      `INSERT OR REPLACE INTO share_range_leases
       (lease_id, share_id, token_hash, next_offset, expires_at)
       VALUES (?, ?, ?, ?, ?)`,
      lease.leaseId, lease.shareId, lease.tokenHash, lease.nextOffset, lease.expiresAt,
    );
  }

  deleteLease(leaseId) {
    this.sql.exec('DELETE FROM share_range_leases WHERE lease_id = ?', leaseId);
  }

  revoke(shareId) {
    this.sql.exec(
      'UPDATE private_shares SET revoked = 1 WHERE share_id = ?',
      shareId,
    );
  }
}
