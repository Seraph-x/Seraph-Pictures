const { get, run, transaction } = require('../../db');
const { decideShareUse } = require('../../../shared/security/share-policy.cjs');

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

class ShareRepository {
  constructor(db) {
    this.db = db;
  }

  create(record) {
    run(
      this.db,
      `INSERT INTO private_shares(
        share_id, file_id, expires_at, access_version, revoked,
        password_hash, max_downloads, download_count, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        record.shareId, record.fileId, record.expiresAt, record.accessVersion,
        record.revoked ? 1 : 0, record.passwordHash, record.maxDownloads,
        record.downloadCount, record.createdAt,
      ],
    );
    return this.getById(record.shareId);
  }

  transaction(operation) {
    return transaction(this.db, operation);
  }

  getById(shareId) {
    return mapRecord(get(
      this.db,
      'SELECT * FROM private_shares WHERE share_id = ?',
      [shareId],
    ));
  }

  consume(options) {
    return transaction(this.db, () => {
      const record = this.getById(options.shareId);
      const decision = decideShareUse({
        record,
        nowMs: options.nowMs,
        expectedAccessVersion: options.expectedAccessVersion,
        passwordVerified: options.passwordVerified,
      });
      if (!decision.allowed) return Object.freeze({ ok: false, code: decision.code });
      run(
        this.db,
        'UPDATE private_shares SET download_count = download_count + 1 WHERE share_id = ?',
        [options.shareId],
      );
      return Object.freeze({ ok: true, record: this.getById(options.shareId) });
    });
  }

  consumeAndStartLease(options) {
    return transaction(this.db, () => {
      const record = this.getById(options.shareId);
      const decision = decideShareUse({
        record,
        nowMs: options.nowMs,
        expectedAccessVersion: options.expectedAccessVersion,
        passwordVerified: options.passwordVerified,
      });
      if (!decision.allowed) return Object.freeze({ ok: false, code: decision.code });
      run(
        this.db,
        'UPDATE private_shares SET download_count = download_count + 1 WHERE share_id = ?',
        [options.shareId],
      );
      this.putLease(options.lease);
      return Object.freeze({ ok: true });
    });
  }

  revoke(shareId) {
    return transaction(this.db, () => {
      const exists = Boolean(this.getById(shareId));
      if (exists) run(
        this.db,
        'UPDATE private_shares SET revoked = 1 WHERE share_id = ?',
        [shareId],
      );
      return Object.freeze({ revoked: exists });
    });
  }

  getLease(shareId, leaseId) {
    return get(
      this.db,
      'SELECT * FROM share_range_leases WHERE share_id = ? AND lease_id = ?',
      [shareId, leaseId],
    ) || null;
  }

  putLease(lease) {
    run(
      this.db,
      `INSERT OR REPLACE INTO share_range_leases
       (lease_id, share_id, token_hash, next_offset, expires_at)
       VALUES (?, ?, ?, ?, ?)`,
      [lease.leaseId, lease.shareId, lease.tokenHash, lease.nextOffset, lease.expiresAt],
    );
    return this.getLease(lease.shareId, lease.leaseId);
  }

  deleteLease(leaseId) {
    run(this.db, 'DELETE FROM share_range_leases WHERE lease_id = ?', [leaseId]);
  }
}

module.exports = { ShareRepository };
