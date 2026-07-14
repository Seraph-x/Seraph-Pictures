'use strict';

const MASKED_SECRET = '********';
const DEFAULT_R2_REGION = 'auto';
const CONFLICT_STATUS = 409;
const NOT_FOUND_STATUS = 404;

const SECRET_FIELDS = Object.freeze({
  telegram: Object.freeze(['botToken']),
  r2: Object.freeze(['accessKeyId', 'secretAccessKey']),
  s3: Object.freeze(['accessKeyId', 'secretAccessKey']),
  discord: Object.freeze(['botToken', 'webhookUrl']),
  huggingface: Object.freeze(['token']),
  webdav: Object.freeze(['password', 'bearerToken', 'token']),
  github: Object.freeze(['token']),
});

const ERROR_STATUSES = Object.freeze({
  STORAGE_SELECTION_REQUIRED: 400,
  STORAGE_PROFILE_NOT_FOUND: NOT_FOUND_STATUS,
  STORAGE_TYPE_MISMATCH: 400,
  STORAGE_NOT_WRITABLE: CONFLICT_STATUS,
  STORAGE_DEFAULT_LOCKED: CONFLICT_STATUS,
  STORAGE_DEFAULT_REQUIRED: CONFLICT_STATUS,
  STORAGE_PROFILE_IN_USE: CONFLICT_STATUS,
  STORAGE_SECRET_REQUIRED: 400,
  STORAGE_CONFIG_REQUIRED: 400,
  STORAGE_CONFIG_INVALID: 400,
  STORAGE_PROFILE_INTEGRITY_ERROR: 500,
  STORAGE_MIGRATION_FAILED: 500,
});

class StoragePolicyError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.code = code;
    this.status = ERROR_STATUSES[code] || 400;
    Object.assign(this, details);
  }
}

function fail(code, details) {
  throw new StoragePolicyError(code, details);
}

function immutableProfile(profile) {
  const config = Object.freeze({ ...(profile.config || {}) });
  const metadata = profile.metadata ? Object.freeze({ ...profile.metadata }) : profile.metadata;
  return Object.freeze({ ...profile, config, ...(metadata ? { metadata } : {}) });
}

function hasReferences(references) {
  if (typeof references === 'number') return references > 0;
  if (Array.isArray(references)) return references.length > 0;
  if (references && typeof references.size === 'number') return references.size > 0;
  return Boolean(references);
}

function validateFirstProfile({ items, profile }) {
  const sameType = items.filter((item) => item.type === profile.type);
  if (sameType.length > 0) return profile;
  if (!profile.enabled || profile.isDefault === false) fail('STORAGE_DEFAULT_REQUIRED');
  return { ...profile, isDefault: true };
}

function validateDefaultMutation({ current, candidate }) {
  if (!current?.isDefault) return;
  const disables = candidate === null || !candidate.enabled;
  const changesType = candidate?.type !== current.type;
  if (disables || changesType || candidate.isDefault === false) fail('STORAGE_DEFAULT_LOCKED');
}

function validateUniqueDefault({ items, current, candidate }) {
  if (!candidate.isDefault) return;
  const otherDefault = items.some((item) => (
    item.type === candidate.type && item.isDefault && item.id !== current?.id
  ));
  if (otherDefault) fail('STORAGE_DEFAULT_REQUIRED');
}

function validateProfileMutation({ items = [], current = null, patch, references = 0 }) {
  const deleting = patch === null;
  const changesType = current && patch?.type && patch.type !== current.type;
  if (hasReferences(references) && (deleting || changesType)) fail('STORAGE_PROFILE_IN_USE');
  if (deleting) {
    validateDefaultMutation({ current, candidate: null });
    return null;
  }
  const candidate = { ...(current || {}), ...(patch || {}) };
  validateDefaultMutation({ current, candidate });
  const withDefault = validateFirstProfile({ items, profile: candidate });
  validateUniqueDefault({ items, current, candidate: withDefault });
  const config = validateProfileConfig({
    type: withDefault.type,
    config: withDefault.config,
    previousType: current?.type,
  });
  return immutableProfile({ ...withDefault, config });
}

function applyPerTypeDefault({ items = [], profileId }) {
  const selected = items.find((item) => item.id === profileId);
  if (!selected) fail('STORAGE_PROFILE_NOT_FOUND');
  if (!selected.enabled) fail('STORAGE_NOT_WRITABLE');
  const output = items.map((item) => immutableProfile({
    ...item,
    isDefault: item.type === selected.type ? item.id === selected.id : item.isDefault,
  }));
  return Object.freeze(output);
}

function selectedType({ storageMode, preferredType }) {
  const type = String(storageMode || preferredType || '').trim().toLowerCase();
  if (!type) fail('STORAGE_SELECTION_REQUIRED');
  return type;
}

function resolveProfileSelection(options) {
  const { items = [], storageId, storageMode, forWrite = false } = options;
  let selected;
  if (storageId) {
    selected = items.find((item) => item.id === storageId);
    if (!selected) fail('STORAGE_PROFILE_NOT_FOUND');
    if (storageMode && selected.type !== String(storageMode).toLowerCase()) {
      fail('STORAGE_TYPE_MISMATCH');
    }
  } else {
    const type = selectedType(options);
    selected = items.find((item) => item.type === type && item.isDefault && item.enabled);
    if (!selected) fail('STORAGE_PROFILE_NOT_FOUND');
  }
  if (forWrite && !selected.enabled) fail('STORAGE_NOT_WRITABLE');
  return selected;
}

function requiredConfigField(config, field, secret = false) {
  if (String(config[field] || '').trim()) return;
  fail(secret ? 'STORAGE_SECRET_REQUIRED' : 'STORAGE_CONFIG_REQUIRED', { field });
}

function validateR2Config(config) {
  const adapterMode = String(config.adapterMode || '').trim().toLowerCase();
  if (!['binding', 's3'].includes(adapterMode)) {
    fail('STORAGE_CONFIG_REQUIRED', { field: 'adapterMode' });
  }
  if (adapterMode === 'binding') {
    requiredConfigField(config, 'bindingName');
    return Object.freeze({ ...config, adapterMode });
  }
  for (const field of ['endpoint', 'bucket']) requiredConfigField(config, field);
  for (const field of SECRET_FIELDS.r2) requiredConfigField(config, field, true);
  return Object.freeze({ ...config, adapterMode, region: config.region || DEFAULT_R2_REGION });
}

function validateDiscordConfig(config) {
  if (String(config.webhookUrl || '').trim()) return config;
  requiredConfigField(config, 'botToken', true);
  requiredConfigField(config, 'channelId');
  return config;
}

function validateWebDavConfig(config) {
  requiredConfigField(config, 'baseUrl');
  if (String(config.bearerToken || config.token || '').trim()) return config;
  requiredConfigField(config, 'username');
  requiredConfigField(config, 'password', true);
  return config;
}

function validateStandardConfig(type, config) {
  const required = {
    telegram: [['botToken', true], ['chatId', false]],
    s3: [['endpoint', false], ['bucket', false], ['accessKeyId', true], ['secretAccessKey', true]],
    huggingface: [['token', true], ['repo', false]],
    github: [['repo', false], ['token', true]],
  }[type];
  if (type === 'discord') return validateDiscordConfig(config);
  if (type === 'webdav') return validateWebDavConfig(config);
  for (const [field, secret] of required || []) requiredConfigField(config, field, secret);
  return config;
}

function validateProfileConfig({ type, config = {} }) {
  const normalized = Object.freeze({ ...config });
  return type === 'r2'
    ? validateR2Config(normalized)
    : Object.freeze(validateStandardConfig(type, normalized));
}

function storageSecretFields(type) {
  return SECRET_FIELDS[String(type || '').toLowerCase()] || Object.freeze([]);
}

function presentProfile(profile) {
  const fields = storageSecretFields(profile.type);
  const config = { ...(profile.config || {}) };
  const secretsPresent = {};
  for (const field of fields) {
    secretsPresent[field] = Boolean(config[field]);
    config[field] = secretsPresent[field] ? MASKED_SECRET : '';
  }
  return Object.freeze({
    ...profile,
    config: Object.freeze(config),
    secretsPresent: Object.freeze(secretsPresent),
  });
}

function storageErrorDetails(error = {}) {
  const code = error.code || 'STORAGE_OPERATION_FAILED';
  return Object.freeze({ code, status: error.status || ERROR_STATUSES[code] || 500 });
}

module.exports = Object.freeze({
  MASKED_SECRET,
  ERROR_STATUSES,
  StoragePolicyError,
  validateProfileMutation,
  applyPerTypeDefault,
  resolveProfileSelection,
  validateProfileConfig,
  presentProfile,
  storageSecretFields,
  storageErrorDetails,
});
