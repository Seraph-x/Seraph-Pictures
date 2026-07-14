const AUTH_STATUSES = Object.freeze([401, 403]);
const RATE_LIMIT_STATUSES = Object.freeze([429]);
const QUOTA_STATUSES = Object.freeze([413, 507, 509]);
const NOT_FOUND_STATUSES = Object.freeze([404]);
const NETWORK_STATUSES = Object.freeze([408, 502, 503, 504]);
const APPLICATION_ERROR_PATTERN = /^[A-Z][A-Z0-9_]+$/;

const CLASSIFICATIONS = Object.freeze([
  Object.freeze({
    matches: (message, status) => AUTH_STATUSES.includes(status)
      || /\bauth|unauthori[sz]ed|forbidden|invalid token|permission denied\b/.test(message),
    result: Object.freeze({
      code: 'AUTH_FAILED', message: 'Authentication failed or permission denied.', retriable: false,
    }),
  }),
  Object.freeze({
    matches: (message, status) => RATE_LIMIT_STATUSES.includes(status)
      || /\brate limit|too many requests|flood wait|throttle\b/.test(message),
    result: Object.freeze({
      code: 'RATE_LIMITED', message: 'Rate limit reached, retry later.', retriable: true,
    }),
  }),
  Object.freeze({
    matches: (message, status) => QUOTA_STATUSES.includes(status)
      || /\bquota|insufficient storage|storage limit|file too large|payload too large\b/.test(message),
    result: Object.freeze({
      code: 'QUOTA_EXCEEDED', message: 'Storage quota or size limit exceeded.', retriable: false,
    }),
  }),
  Object.freeze({
    matches: (message, status) => NOT_FOUND_STATUSES.includes(status)
      || /\bnot found|path does not exist|no such file|missing resource\b/.test(message),
    result: Object.freeze({
      code: 'PATH_NOT_FOUND', message: 'Target path or resource does not exist.', retriable: false,
    }),
  }),
  Object.freeze({
    matches: (message) => /\bnot configured|missing required|requires .*token|requires .*id\b/.test(message),
    result: Object.freeze({
      code: 'NOT_CONFIGURED', message: 'Storage adapter is not configured yet.', retriable: false,
    }),
  }),
  Object.freeze({
    matches: (message, status) => NETWORK_STATUSES.includes(status)
      || /\bnetwork|timeout|timed out|fetch failed|econn|enotfound|eai_again|socket\b/.test(message),
    result: Object.freeze({
      code: 'NETWORK_ERROR', message: 'Network timeout or upstream connectivity issue.', retriable: true,
    }),
  }),
]);

const UNKNOWN_CLASSIFICATION = Object.freeze({
  code: 'UNKNOWN', message: 'Unexpected storage error.', retriable: false,
});

function normalizeErrorMessage(error, fallback = 'Unknown storage error') {
  if (!error) return fallback;
  if (typeof error === 'string') return error;
  if (error instanceof Error && error.message) return error.message;
  if (typeof error.message === 'string' && error.message) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return fallback;
  }
}

function explicitApplicationError(error, status) {
  const code = String(error?.code || '');
  if (!APPLICATION_ERROR_PATTERN.test(code)) return null;
  if (status < 400 || status > 599) return null;
  return Object.freeze({
    code,
    message: normalizeErrorMessage(error, code),
    retriable: error?.retriable === true,
  });
}

function classifyStorageError(error, status) {
  const statusCode = Number(status || 0);
  const explicit = explicitApplicationError(error, statusCode);
  if (explicit) return explicit;
  const message = normalizeErrorMessage(error).toLowerCase();
  const matched = CLASSIFICATIONS.find((entry) => entry.matches(message, statusCode));
  return matched?.result || UNKNOWN_CLASSIFICATION;
}

function toStorageErrorPayload(error, status) {
  const normalized = classifyStorageError(error, status);
  return {
    ...normalized,
    detail: normalizeErrorMessage(error),
    status: Number(status || 0) || undefined,
  };
}

module.exports = {
  classifyStorageError,
  normalizeErrorMessage,
  toStorageErrorPayload,
};
