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
});

export function isValidOperationResult(operation, value) {
  return VALIDATORS[operation]?.(value) === true;
}
