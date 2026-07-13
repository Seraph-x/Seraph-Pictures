import sharePolicy from '../../../../shared/security/share-policy.cjs';

const { buildSharePayload, decideShareUse } = sharePolicy;

function invalidRecord() {
  const error = new Error('SHARE_RECORD_INVALID');
  error.code = 'SHARE_RECORD_INVALID';
  return error;
}

function validateRecord(record) {
  buildSharePayload(record);
  if (record.revoked !== false || record.downloadCount !== 0) throw invalidRecord();
  if (record.passwordHash !== null && typeof record.passwordHash !== 'string') {
    throw invalidRecord();
  }
  if (record.maxDownloads !== null
    && (!Number.isInteger(record.maxDownloads) || record.maxDownloads < 1)) {
    throw invalidRecord();
  }
  if (!Number.isFinite(record.createdAt)) throw invalidRecord();
  if (record.accessVersion < 1 || record.expiresAt <= record.createdAt) throw invalidRecord();
  return Object.freeze({ ...record });
}

function validLeaseIdentity(options) {
  return typeof options?.shareId === 'string'
    && options.shareId.length > 0
    && typeof options.leaseId === 'string'
    && options.leaseId.length > 0
    && typeof options.tokenHash === 'string'
    && options.tokenHash.length > 0
    && Number.isInteger(options.rangeStart)
    && options.rangeStart >= 0;
}

function leaseMatches(lease, options) {
  return Boolean(lease)
    && lease.lease_id === options.leaseId
    && lease.token_hash === options.tokenHash
    && lease.next_offset === options.rangeStart
    && lease.expires_at > options.nowMs;
}

export class ShareCoordinatorService {
  constructor({ repository }) {
    this.repository = repository;
  }

  create(record) {
    const validated = validateRecord(record);
    return this.repository.transaction(() => {
      this.repository.deleteExpired(validated.createdAt);
      if (this.repository.read(validated.shareId)) {
        return Object.freeze({ ok: false, code: 'SHARE_ID_CONFLICT' });
      }
      this.repository.insert(validated);
      return Object.freeze({ ok: true, record: this.repository.read(validated.shareId) });
    });
  }

  read({ shareId }) {
    return Object.freeze({ record: this.repository.read(shareId) });
  }

  consume(options) {
    return this.repository.transaction(() => {
      const record = this.repository.read(options.shareId);
      const decision = decideShareUse({
        record,
        nowMs: options.nowMs,
        expectedAccessVersion: options.expectedAccessVersion,
        passwordVerified: options.passwordVerified,
      });
      if (!decision.allowed) return Object.freeze({ ok: false, code: decision.code });
      this.repository.increment(options.shareId);
      return Object.freeze({ ok: true, record: this.repository.read(options.shareId) });
    });
  }

  revoke({ shareId }) {
    return this.repository.transaction(() => {
      const exists = Boolean(this.repository.read(shareId));
      if (exists) this.repository.revoke(shareId);
      return Object.freeze({ revoked: exists });
    });
  }

  leaseRead(options) {
    if (!validLeaseIdentity(options)) return Object.freeze({ allowed: false });
    const lease = this.repository.readLease(options.shareId, options.leaseId);
    return Object.freeze({ allowed: leaseMatches(lease, options) });
  }

  consumeStartLease(options) {
    if (!validLeaseIdentity(options)
      || options.rangeStart !== 0
      || !Number.isInteger(options.nextOffset)
      || options.nextOffset <= options.rangeStart) {
      return Object.freeze({ ok: false, code: 'SHARE_LEASE_INVALID' });
    }
    return this.repository.transaction(() => {
      const record = this.repository.read(options.shareId);
      const decision = decideShareUse({
        record,
        nowMs: options.nowMs,
        expectedAccessVersion: options.expectedAccessVersion,
        passwordVerified: options.passwordVerified,
      });
      if (!decision.allowed) return Object.freeze({ ok: false, code: decision.code });
      this.repository.increment(options.shareId);
      this.repository.putLease({
        leaseId: options.leaseId,
        shareId: options.shareId,
        tokenHash: options.tokenHash,
        nextOffset: options.nextOffset,
        expiresAt: record.expiresAt,
      });
      return Object.freeze({ ok: true });
    });
  }

  leaseAdvance(options) {
    const invalidNext = !options.complete
      && (typeof options.nextLeaseId !== 'string'
        || !options.nextLeaseId
        || typeof options.nextTokenHash !== 'string'
        || !options.nextTokenHash
        || !Number.isInteger(options.nextOffset)
        || options.nextOffset <= options.rangeStart);
    if (!validLeaseIdentity(options) || invalidNext) {
      return Object.freeze({ ok: false, code: 'SHARE_LEASE_INVALID' });
    }
    return this.repository.transaction(() => {
      const lease = this.repository.readLease(options.shareId, options.leaseId);
      if (!leaseMatches(lease, options)) {
        return Object.freeze({ ok: false, code: 'SHARE_LEASE_STALE' });
      }
      if (options.complete) this.repository.deleteLease(options.leaseId);
      else {
        this.repository.deleteLease(options.leaseId);
        this.repository.putLease({
          leaseId: options.nextLeaseId,
          shareId: options.shareId,
          tokenHash: options.nextTokenHash,
          nextOffset: options.nextOffset,
          expiresAt: lease.expires_at,
        });
      }
      return Object.freeze({ ok: true });
    });
  }
}
