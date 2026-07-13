const PLACEHOLDER_PATTERN = /^(replace_with|change_this|your[_-]?secret|placeholder)/i;
const { MIN_SHARE_SECRET_CHARACTERS } = require('../../../shared/security/share-policy.cjs');

function normalize(value) {
  const text = String(value || '').trim();
  const quoted = (text.startsWith('"') && text.endsWith('"'))
    || (text.startsWith("'") && text.endsWith("'"));
  return quoted ? text.slice(1, -1).trim() : text;
}

function parseTimestamp(value) {
  const timestamp = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : 0;
}

function loadShareConfig({ env, nodeEnv }) {
  const currentSecret = normalize(env.FILE_SHARE_SECRET_CURRENT);
  const insecureCurrent = !currentSecret
    || currentSecret.length < MIN_SHARE_SECRET_CHARACTERS
    || PLACEHOLDER_PATTERN.test(currentSecret);
  if (nodeEnv === 'production' && insecureCurrent) {
    const error = new Error('Insecure production configuration: FILE_SHARE_SECRET_CURRENT');
    error.code = 'INSECURE_PRODUCTION_CONFIG';
    error.variables = Object.freeze(['FILE_SHARE_SECRET_CURRENT']);
    throw error;
  }
  const previousSecret = normalize(env.FILE_SHARE_SECRET_PREVIOUS);
  const previousValidUntil = parseTimestamp(env.FILE_SHARE_SECRET_PREVIOUS_VALID_UNTIL);
  if (previousValidUntil > Date.now()
    && previousSecret.length < MIN_SHARE_SECRET_CHARACTERS) {
    const error = new Error('Insecure production configuration: FILE_SHARE_SECRET_PREVIOUS');
    error.code = 'INSECURE_PRODUCTION_CONFIG';
    error.variables = Object.freeze(['FILE_SHARE_SECRET_PREVIOUS']);
    throw error;
  }
  return Object.freeze({
    currentSecret,
    previousSecret,
    previousValidUntil,
  });
}

module.exports = { loadShareConfig };
