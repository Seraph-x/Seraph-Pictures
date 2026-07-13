const MIN_SHARE_TTL_SECONDS = 60;
const DEFAULT_SHARE_TTL_SECONDS = 24 * 60 * 60;
const MAX_SHARE_TTL_SECONDS = 30 * 24 * 60 * 60;
const MIN_SHARE_SECRET_CHARACTERS = 32;

const ALLOWED = Object.freeze({ allowed: true, code: null });

function shareError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function denied(code) {
  return Object.freeze({ allowed: false, code });
}

function validTtl(ttlSeconds) {
  return Number.isInteger(ttlSeconds)
    && ttlSeconds >= MIN_SHARE_TTL_SECONDS
    && ttlSeconds <= MAX_SHARE_TTL_SECONDS;
}

function normalizeShareRequest(options) {
  const {
    fileId,
    accessVersion,
    ttlSeconds = DEFAULT_SHARE_TTL_SECONDS,
    nowMs = Date.now(),
    maxDownloads = null,
  } = options;
  if (typeof fileId !== 'string' || !fileId) throw shareError('SHARE_FILE_INVALID');
  if (!Number.isInteger(accessVersion) || accessVersion < 1) {
    throw shareError('SHARE_ACCESS_VERSION_INVALID');
  }
  if (!Number.isFinite(nowMs)) throw shareError('SHARE_TIME_INVALID');
  if (!validTtl(ttlSeconds)) throw shareError('SHARE_TTL_INVALID');
  if (maxDownloads !== null
    && (!Number.isInteger(maxDownloads) || maxDownloads < 1)) {
    throw shareError('SHARE_DOWNLOAD_LIMIT_INVALID');
  }
  return Object.freeze({
    fileId,
    accessVersion,
    expiresAt: nowMs + ttlSeconds * 1000,
    maxDownloads,
  });
}

function buildSharePayload(record) {
  const { shareId, fileId, expiresAt, accessVersion } = record;
  if (![shareId, fileId].every((value) => typeof value === 'string' && value)) {
    throw shareError('SHARE_PAYLOAD_INVALID');
  }
  if (!Number.isFinite(expiresAt) || !Number.isInteger(accessVersion)) {
    throw shareError('SHARE_PAYLOAD_INVALID');
  }
  return `${shareId}:${fileId}:${expiresAt}:${accessVersion}`;
}

function eligibleShareSecrets({ current, previous, previousValidUntil, nowMs = Date.now() }) {
  if (typeof current !== 'string' || !current) throw shareError('SHARE_SECRET_UNAVAILABLE');
  if (current.length < MIN_SHARE_SECRET_CHARACTERS) throw shareError('SHARE_SECRET_INVALID');
  const previousActive = typeof previous === 'string'
    && previous.length > 0
    && Number.isFinite(previousValidUntil)
    && previousValidUntil > nowMs;
  if (previousActive && previous.length < MIN_SHARE_SECRET_CHARACTERS) {
    throw shareError('SHARE_SECRET_INVALID');
  }
  return Object.freeze(previousActive && previous !== current
    ? [current, previous]
    : [current]);
}

function decideShareUse(options) {
  const {
    record,
    nowMs = Date.now(),
    expectedAccessVersion = record?.accessVersion,
    passwordVerified = !record?.passwordHash,
  } = options;
  if (!record || typeof record !== 'object') return denied('SHARE_NOT_FOUND');
  if (record.revoked === true) return denied('SHARE_REVOKED');
  if (!Number.isFinite(record.expiresAt) || record.expiresAt <= nowMs) {
    return denied('SHARE_EXPIRED');
  }
  if (!Number.isInteger(record.accessVersion)
    || record.accessVersion !== expectedAccessVersion) {
    return denied('SHARE_ACCESS_VERSION_STALE');
  }
  if (record.passwordHash && !passwordVerified) return denied('SHARE_PASSWORD_REQUIRED');
  if (Number.isInteger(record.maxDownloads)
    && record.downloadCount >= record.maxDownloads) {
    return denied('SHARE_DOWNLOAD_LIMIT');
  }
  return ALLOWED;
}

module.exports = {
  DEFAULT_SHARE_TTL_SECONDS,
  MAX_SHARE_TTL_SECONDS,
  MIN_SHARE_TTL_SECONDS,
  MIN_SHARE_SECRET_CHARACTERS,
  buildSharePayload,
  decideShareUse,
  eligibleShareSecrets,
  normalizeShareRequest,
};
