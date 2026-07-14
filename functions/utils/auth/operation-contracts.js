function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isSession(value) {
  return isObject(value) && typeof value.token === 'string' && value.token.length > 0;
}

function isResult(value) {
  if (!isObject(value) || typeof value.ok !== 'boolean') return false;
  if (!value.ok) return typeof value.code === 'string';
  return value.session == null || isSession(value.session);
}

function isProfile(value) {
  if (!isObject(value) || typeof value.initialized !== 'boolean') return false;
  if (!value.initialized) return true;
  return typeof value.username === 'string' && Number.isInteger(value.credVersion);
}

function isConfigAuthority(value) {
  if (!isObject(value) || typeof value.initialized !== 'boolean') return false;
  if (!value.initialized) return value.committedVersion === null && value.digest === null;
  return Number.isInteger(value.committedVersion)
    && value.committedVersion > 0
    && typeof value.digest === 'string'
    && value.digest.length > 0;
}

function isStorageCatalogAuthority(value) {
  return isObject(value)
    && typeof value.initialized === 'boolean'
    && (value.initialized
      ? typeof value.generation === 'string' && value.generation.length > 0
      : value.generation === null);
}

function isShareRecord(value) {
  return isObject(value)
    && typeof value.shareId === 'string'
    && value.shareId.length > 0
    && typeof value.fileId === 'string'
    && value.fileId.length > 0
    && Number.isFinite(value.expiresAt)
    && Number.isInteger(value.accessVersion)
    && value.accessVersion >= 1
    && typeof value.revoked === 'boolean'
    && (value.passwordHash === null || typeof value.passwordHash === 'string')
    && (value.maxDownloads === null
      || (Number.isInteger(value.maxDownloads) && value.maxDownloads >= 1))
    && Number.isInteger(value.downloadCount)
    && value.downloadCount >= 0
    && Number.isFinite(value.createdAt)
    && value.createdAt >= 0
    && value.expiresAt > value.createdAt;
}

function isBarrierStatus(value) {
  if (!isObject(value) || typeof value.frozen !== 'boolean') return false;
  const identityValid = value.frozen
    ? (typeof value.generation === 'string' && value.generation.length > 0
      && typeof value.audience === 'string' && value.audience.length > 0)
    : value.generation === null && value.audience === null;
  return identityValid && Number.isInteger(value.active) && value.active >= 0;
}

const VALIDATORS = Object.freeze({
  bootstrapLogin: (value) => isResult(value) && (!value.ok || isSession(value.session)),
  migrateLegacyLogin: (value) => isResult(value) && (!value.ok || isSession(value.session)),
  completeLegacyCredentialCleanup: (value) => isObject(value) && value.ok === true,
  verifyCredentials: isResult,
  verifySession: (value) => typeof value === 'boolean',
  issueSession: (value) => isResult(value) && (!value.ok || isSession(value.session)),
  readProfile: isProfile,
  getProfile: isResult,
  changeCredentials: (value) => isResult(value) && (!value.ok || isSession(value.session)),
  logout: (value) => isObject(value) && value.ok === true,
  status: (value) => isObject(value)
    && typeof value.initialized === 'boolean'
    && Number.isInteger(value.schemaVersion)
    && (value.legacyCleanupRequired == null || typeof value.legacyCleanupRequired === 'boolean'),
  listPasskeys: (value) => isObject(value) && Array.isArray(value.items),
  putPasskeyChallenge: (value) => isObject(value) && value.ok === true,
  takePasskeyChallenge: (value) => isObject(value)
    && (value.challenge === null || typeof value.challenge === 'string'),
  savePasskey: isResult,
  updatePasskeyCounter: isResult,
  renamePasskey: isResult,
  deletePasskey: isResult,
  passkeyMigrationStatus: (value) => isObject(value)
    && typeof value.migrated === 'boolean'
    && (value.cleanupRequired == null || typeof value.cleanupRequired === 'boolean'),
  migrateLegacyPasskeys: (value) => isResult(value) && (!value.ok || Array.isArray(value.items)),
  completeLegacyPasskeyCleanup: (value) => isObject(value) && value.ok === true,
  configReadAuthority: isConfigAuthority,
  configBegin: (value) => isResult(value)
    && (!value.ok || Number.isInteger(value.version)),
  configCommit: (value) => isObject(value)
    && value.ok === true
    && Number.isInteger(value.committedVersion),
  configAbort: (value) => isObject(value) && typeof value.aborted === 'boolean',
  configAbortStale: (value) => isObject(value) && typeof value.aborted === 'boolean',
  storageProfileCatalogReadAuthority: isStorageCatalogAuthority,
  storageProfileCatalogActivate: (value) => isObject(value)
    && value.ok === true
    && typeof value.generation === 'string'
    && value.generation.length > 0,
  shareCreate: (value) => isResult(value) && (!value.ok || isShareRecord(value.record)),
  shareRead: (value) => isObject(value)
    && (value.record === null || isShareRecord(value.record)),
  shareConsume: (value) => isResult(value) && (!value.ok || isShareRecord(value.record)),
  shareRevoke: (value) => isObject(value) && typeof value.revoked === 'boolean',
  shareLeaseRead: (value) => isObject(value) && typeof value.allowed === 'boolean',
  shareConsumeStartLease: (value) => isResult(value),
  shareLeaseAdvance: (value) => isResult(value),
  quotaReserve: (value) => isResult(value)
    && (!value.ok || (typeof value.reservationId === 'string'
      && Number.isFinite(value.expiresAt))),
  quotaComplete: (value) => isObject(value)
    && value.ok === true && typeof value.completed === 'boolean',
  quotaCancel: (value) => isObject(value)
    && value.ok === true && typeof value.cancelled === 'boolean',
  quotaReleaseExpired: (value) => isObject(value)
    && Number.isInteger(value.released) && value.released >= 0,
  mutationEnter: (value) => isObject(value)
    && typeof value.allowed === 'boolean'
    && (value.allowed
      ? (typeof value.leaseId === 'string' && value.leaseId.length > 0)
      : value.leaseId === null)
    && Number.isInteger(value.active) && value.active >= 0,
  mutationExit: (value) => isObject(value)
    && typeof value.released === 'boolean'
    && Number.isInteger(value.active) && value.active >= 0,
  mutationFreezeBegin: isBarrierStatus,
  mutationFreezeEnd: isBarrierStatus,
  mutationFreezeStatus: isBarrierStatus,
  mutationReleaseExpired: (value) => isObject(value)
    && Number.isInteger(value.released) && value.released >= 0,
});

export function isValidOperationResult(operation, value) {
  return VALIDATORS[operation]?.(value) === true;
}
