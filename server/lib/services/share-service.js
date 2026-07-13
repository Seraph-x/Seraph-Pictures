const crypto = require('node:crypto');
const {
  buildSharePayload,
  decideShareUse,
  eligibleShareSecrets,
  normalizeShareRequest,
} = require('../../../shared/security/share-policy.cjs');

const SHARE_ID_BYTES = 24;
const PASSWORD_SALT_BYTES = 16;
const PASSWORD_KEY_LENGTH = 32;

function hmac(secret, record) {
  return crypto.createHmac('sha256', secret).update(buildSharePayload(record)).digest('hex');
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));
  return leftBuffer.length === rightBuffer.length
    && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function hashPassword(password) {
  if (!password) return null;
  const salt = crypto.randomBytes(PASSWORD_SALT_BYTES).toString('hex');
  const hash = crypto.scryptSync(password, salt, PASSWORD_KEY_LENGTH).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

function verifyPassword(password, encoded) {
  if (!encoded) return true;
  const [algorithm, salt, expected] = String(encoded).split(':');
  if (algorithm !== 'scrypt' || !salt || !expected) return false;
  const actual = crypto.scryptSync(String(password || ''), salt, PASSWORD_KEY_LENGTH).toString('hex');
  return safeEqual(actual, expected);
}

function tokenHash(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

class ShareService {
  constructor(options) {
    this.repository = options.repository;
    this.currentSecret = options.currentSecret;
    this.previousSecret = options.previousSecret || '';
    this.previousValidUntil = Number(options.previousValidUntil || 0);
    this.clock = options.clock || { now: () => Date.now() };
    this.ids = options.ids || { create: () => crypto.randomBytes(SHARE_ID_BYTES).toString('hex') };
  }

  secrets(nowMs) {
    return eligibleShareSecrets({
      current: this.currentSecret,
      previous: this.previousSecret,
      previousValidUntil: this.previousValidUntil,
      nowMs,
    });
  }

  create(options) {
    const nowMs = this.clock.now();
    const normalized = normalizeShareRequest({ ...options, nowMs });
    const record = Object.freeze({
      shareId: this.ids.create(),
      ...normalized,
      revoked: false,
      passwordHash: hashPassword(String(options.password || '')),
      downloadCount: 0,
      createdAt: nowMs,
    });
    this.repository.create(record);
    return Object.freeze({ ...record, signature: hmac(this.secrets(nowMs)[0], record) });
  }

  validSignature(record, signature, nowMs) {
    return this.secrets(nowMs).some((secret) => safeEqual(hmac(secret, record), signature));
  }

  createLeaseCredentials() {
    const token = crypto.randomBytes(SHARE_ID_BYTES).toString('hex');
    return Object.freeze({
      leaseId: crypto.randomBytes(PASSWORD_SALT_BYTES).toString('hex'),
      token,
      tokenHash: tokenHash(token),
    });
  }

  validLease(record, options) {
    if (!options?.leaseId || !options.token) return false;
    const lease = this.repository.getLease(record.shareId, options.leaseId);
    return Boolean(lease)
      && lease.lease_id === options.leaseId
      && safeEqual(lease.token_hash, tokenHash(options.token))
      && lease.next_offset === options.rangeStart
      && lease.expires_at > this.clock.now();
  }

  authorize(options) {
    const record = this.repository.getById(options.shareId);
    if (!record) return Object.freeze({ ok: false, code: 'SHARE_NOT_FOUND' });
    const matching = record.fileId === options.fileId
      && record.expiresAt === options.expiresAt
      && record.accessVersion === options.accessVersion;
    if (!matching || !this.validSignature(record, options.signature, this.clock.now())) {
      return Object.freeze({ ok: false, code: 'SHARE_ENVELOPE_INVALID' });
    }
    const leaseValid = this.validLease(record, options.lease);
    const passwordVerified = leaseValid
      || verifyPassword(options.password, record.passwordHash);
    const decision = decideShareUse({
      record: leaseValid ? { ...record, maxDownloads: null } : record,
      nowMs: this.clock.now(),
      expectedAccessVersion: options.accessVersion,
      passwordVerified,
    });
    return decision.allowed
      ? Object.freeze({ ok: true, record, leaseValid })
      : Object.freeze({ ok: false, code: decision.code });
  }

  consume(options) {
    const authorized = this.authorize({ ...options, lease: null });
    if (!authorized.ok) return authorized;
    return this.repository.consume({
      shareId: authorized.record.shareId,
      nowMs: this.clock.now(),
      expectedAccessVersion: options.accessVersion,
      passwordVerified: true,
    });
  }

  consumeAndStartLease(options) {
    const record = this.repository.getById(options.shareId);
    if (!record) return Object.freeze({ ok: false, code: 'SHARE_NOT_FOUND' });
    const credentials = this.createLeaseCredentials();
    const result = this.repository.consumeAndStartLease({
      shareId: options.shareId,
      nowMs: this.clock.now(),
      expectedAccessVersion: options.accessVersion,
      passwordVerified: verifyPassword(options.password, record.passwordHash),
      lease: {
        ...credentials,
        shareId: options.shareId,
        nextOffset: options.nextOffset,
        expiresAt: record.expiresAt,
      },
    });
    return result.ok ? Object.freeze({ ok: true, credentials }) : result;
  }

  advanceLease(options) {
    return this.repository.transaction(() => {
      const record = this.repository.getById(options.shareId);
      if (!record || !this.validLease(record, options)) return null;
      if (options.complete) {
        this.repository.deleteLease(options.leaseId);
        return Object.freeze({ complete: true });
      }
      const credentials = this.createLeaseCredentials();
      this.repository.deleteLease(options.leaseId);
      this.repository.putLease({
        ...credentials,
        shareId: options.shareId,
        nextOffset: options.nextOffset,
        expiresAt: record.expiresAt,
      });
      return credentials;
    });
  }

  getById(shareId) {
    return this.repository.getById(shareId);
  }

  revoke(shareId) {
    return this.repository.revoke(shareId);
  }
}

module.exports = { ShareService };
