import { callCoordinator } from '../auth/coordinator-client.js';
import { decryptValue, digestConfig, encryptValue, isEncrypted } from './crypto.js';
import { unavailable } from './errors.js';
import { createStorageConfigRepository } from './repository.js';
import {
  STORAGE_CONFIG_SCHEMA_VERSION,
  STORAGE_SCHEMA,
  STORAGE_TYPES,
} from './schema.js';

const COMMIT_ATTEMPTS = 2;
const STORAGE_ENV_KEYS = new Set(
  STORAGE_TYPES.flatMap((type) => STORAGE_SCHEMA[type].map((field) => field.env)),
);

function normalize(value) {
  return String(value == null ? '' : value).trim();
}

function isConfigShapeValid(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return false;
  return STORAGE_TYPES.every((type) => {
    const fields = config[type];
    if (fields === undefined) return true;
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return false;
    return Object.values(fields).every((value) => typeof value === 'string');
  });
}

async function readAuthority(env) {
  try {
    return await callCoordinator(env, 'configReadAuthority', {});
  } catch (error) {
    throw unavailable(error);
  }
}

async function callConfigOperation(env, operation, payload) {
  try {
    return await callCoordinator(env, operation, payload);
  } catch (error) {
    throw unavailable(error);
  }
}

async function verifyRecord(record, authority) {
  const validEnvelope = record?.schemaVersion === STORAGE_CONFIG_SCHEMA_VERSION
    && record?.version === authority.committedVersion
    && record?.digest === authority.digest
    && isConfigShapeValid(record?.config);
  if (!validEnvelope) throw unavailable(new Error('Committed config schema disagrees with authority.'));
  const actualDigest = await digestConfig(record.config);
  if (actualDigest !== record.digest) throw unavailable(new Error('Committed config digest mismatch.'));
  return record.config;
}

async function loadCurrentConfig(env, { migrateLegacy }) {
  const authority = await readAuthority(env);
  const repository = createStorageConfigRepository(env);
  if (authority.initialized) {
    const result = await repository.readVersion(authority.committedVersion);
    if (result.kind !== 'value') throw unavailable(new Error('Committed config is absent.'));
    return Object.freeze({ config: await verifyRecord(result.value, authority), authority, legacy: false });
  }
  const legacy = await repository.readLegacy();
  if (legacy.kind === 'absent') return Object.freeze({ config: null, authority, legacy: false });
  if (!isConfigShapeValid(legacy.value)) throw unavailable(new Error('Legacy config schema is invalid.'));
  if (!migrateLegacy) return Object.freeze({ config: legacy.value, authority, legacy: true });
  let secured;
  try {
    secured = await buildNextConfig(env, legacy.value, {});
    await applyConfig(env, secured, { allowPlaintext: true });
  } catch (error) {
    throw unavailable(error);
  }
  await persistConfig({ env, repository, config: secured, authority });
  return Object.freeze({ config: secured, authority, legacy: false });
}

async function resolveSecret(env, value, allowPlaintext) {
  if (!value) return '';
  return decryptValue(env, value, { allowPlaintext });
}

function stripStorageCredentials(env) {
  return Object.fromEntries(
    Object.entries(env).filter(([key]) => !STORAGE_ENV_KEYS.has(key)),
  );
}

function readEnvironmentConfig(env) {
  const config = {};
  for (const type of STORAGE_TYPES) {
    config[type] = {};
    for (const field of STORAGE_SCHEMA[type]) {
      const value = normalize(env[field.env]);
      if (value) config[type][field.key] = value;
    }
  }
  return config;
}

async function applyConfig(env, config, { allowPlaintext = false } = {}) {
  if (!config) return env;
  const overrides = {};
  for (const type of STORAGE_TYPES) {
    const stored = config[type];
    if (!stored) continue;
    for (const field of STORAGE_SCHEMA[type]) {
      const value = stored[field.key];
      if (!value) continue;
      const resolved = field.secret
        ? await resolveSecret(env, value, allowPlaintext)
        : String(value);
      if (resolved) overrides[field.env] = resolved;
    }
  }
  return Object.freeze({ ...stripStorageCredentials(env), ...overrides });
}

async function nextFieldValue({ env, field, current, incoming, hasIncoming }) {
  const incomingValue = hasIncoming ? normalize(incoming) : '';
  if (!field.secret) {
    if (hasIncoming) return incomingValue || null;
    return current ? String(current) : null;
  }
  if (incomingValue) return encryptValue(env, incomingValue);
  if (!current) return null;
  return isEncrypted(current) ? current : encryptValue(env, current);
}

async function buildTypeConfig({ env, fields, current, incoming }) {
  const next = {};
  for (const field of fields) {
    const hasIncoming = Object.hasOwn(incoming, field.key);
    const value = await nextFieldValue({
      env,
      field,
      current: current[field.key],
      incoming: incoming[field.key],
      hasIncoming,
    });
    if (value) next[field.key] = value;
  }
  return Object.freeze(next);
}

async function buildNextConfig(env, currentConfig, patch) {
  const next = {};
  for (const type of STORAGE_TYPES) {
    const current = currentConfig?.[type] || {};
    const incoming = patch?.[type] && typeof patch[type] === 'object' ? patch[type] : {};
    next[type] = await buildTypeConfig({
      env,
      fields: STORAGE_SCHEMA[type],
      current,
      incoming,
    });
  }
  return Object.freeze(next);
}

async function readBackPending(repository, record) {
  const result = await repository.readVersion(record.version);
  if (result.kind !== 'value') throw unavailable(new Error('Pending config read-back is absent.'));
  const authority = Object.freeze({
    committedVersion: record.version,
    digest: record.digest,
  });
  await verifyRecord(result.value, authority);
}

async function commitWithRetry(env, payload) {
  let lastError;
  for (let attempt = 0; attempt < COMMIT_ATTEMPTS; attempt += 1) {
    try {
      return await callConfigOperation(env, 'configCommit', payload);
    } catch (error) {
      lastError = error;
    }
  }
  const authority = await readAuthority(env);
  if (authority.committedVersion === payload.version && authority.digest === payload.digest) {
    return Object.freeze({ ok: true, committedVersion: payload.version });
  }
  throw lastError;
}

async function persistConfig({ env, repository, config, authority }) {
  const digest = await digestConfig(config);
  const begun = await callConfigOperation(env, 'configBegin', {
    digest,
    expectedVersion: authority.committedVersion || 0,
    expectedDigest: authority.digest,
  });
  if (!begun.ok) throw unavailable(new Error(begun.code));
  const record = Object.freeze({
    schemaVersion: STORAGE_CONFIG_SCHEMA_VERSION,
    version: begun.version,
    digest,
    config,
  });
  try {
    await repository.writeVersion(record.version, record);
    await readBackPending(repository, record);
    await commitWithRetry(env, { version: record.version, digest });
  } catch (error) {
    await callConfigOperation(env, 'configAbort', { version: record.version, digest });
    throw error;
  }
  return record;
}

function maskConfig(config) {
  const visible = {};
  const secretsPresent = {};
  for (const type of STORAGE_TYPES) {
    visible[type] = {};
    secretsPresent[type] = {};
    const stored = config?.[type] || {};
    for (const field of STORAGE_SCHEMA[type]) {
      if (field.secret) {
        visible[type][field.key] = '';
        secretsPresent[type][field.key] = Boolean(stored[field.key]);
      } else {
        visible[type][field.key] = normalize(stored[field.key]);
      }
    }
  }
  return Object.freeze({ config: visible, secretsPresent });
}

export async function resolveStorageEnv(env = {}) {
  const loaded = await loadCurrentConfig(env, { migrateLegacy: true });
  return applyConfig(env, loaded.config);
}

export async function readStorageConfig(env = {}) {
  const loaded = await loadCurrentConfig(env, { migrateLegacy: true });
  return maskConfig(loaded.config);
}

export async function writeStorageConfig(env = {}, patch = {}) {
  const repository = createStorageConfigRepository(env);
  const loaded = await loadCurrentConfig(env, { migrateLegacy: false });
  const current = loaded.config || readEnvironmentConfig(env);
  const next = await buildNextConfig(env, current, patch);
  await applyConfig(env, next);
  await persistConfig({ env, repository, config: next, authority: loaded.authority });
  return maskConfig(next);
}
