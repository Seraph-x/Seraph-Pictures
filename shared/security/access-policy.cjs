const { ERROR_CODES } = require('./error-codes.cjs');

const ACCESS_ACTORS = Object.freeze({
  ADMIN: 'admin',
  ANONYMOUS: 'anonymous',
});

const FILE_VISIBILITY = Object.freeze({
  PRIVATE: 'private',
  PUBLIC: 'public',
});

const ACCESS_ALLOWED = Object.freeze({
  allowed: true,
  conceal: false,
  code: null,
});

const ACCESS_DENIED = Object.freeze({
  allowed: false,
  conceal: true,
  code: ERROR_CODES.FILE_ACCESS_DENIED,
});

function isCurrentShare({ share, accessVersion, nowSeconds }) {
  if (!share || share.revoked === true) return false;
  if (!Number.isFinite(nowSeconds)) return false;
  if (!Number.isInteger(accessVersion)) return false;

  return Number.isFinite(share.expiresAt)
    && share.expiresAt > nowSeconds
    && share.accessVersion === accessVersion;
}

function decideFileAccess(options) {
  const {
    visibility,
    actor,
    share,
    accessVersion,
    nowSeconds,
    expiresAtMs,
    nowMs,
  } = options;

  if (Number.isFinite(expiresAtMs) && Number.isFinite(nowMs) && expiresAtMs <= nowMs) {
    return ACCESS_DENIED;
  }
  if (visibility === FILE_VISIBILITY.PUBLIC) return ACCESS_ALLOWED;
  if (visibility !== FILE_VISIBILITY.PRIVATE) return ACCESS_DENIED;
  if (actor === ACCESS_ACTORS.ADMIN) return ACCESS_ALLOWED;
  if (isCurrentShare({ share, accessVersion, nowSeconds })) return ACCESS_ALLOWED;
  return ACCESS_DENIED;
}

module.exports = {
  ACCESS_ACTORS,
  FILE_VISIBILITY,
  decideFileAccess,
};
