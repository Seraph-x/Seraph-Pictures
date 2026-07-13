import contractModule from '../../../shared/storage/contracts.cjs';
import { decryptValue, encryptValue } from '../../utils/storage-config/crypto.js';
import { unavailable } from '../../utils/storage-config/errors.js';
import { resolveStorageConfigBinding } from '../../utils/storage-config/repository.js';

const CATALOG_KEY = 'storage_profiles:v1';
const SCHEMA_VERSION = 1;
const { mergeStorageConfig, normalizeStorageItem, storageSecretFields } = contractModule;

function emptyCatalog() {
  return Object.freeze({ schemaVersion: SCHEMA_VERSION, items: Object.freeze([]) });
}

function validateCatalog(value) {
  if (value == null) return emptyCatalog();
  if (value?.schemaVersion !== SCHEMA_VERSION || !Array.isArray(value.items)) {
    throw unavailable(new Error('Storage profile catalog is invalid.'));
  }
  return value;
}

async function readCatalog(binding) {
  try {
    return validateCatalog(await binding.get(CATALOG_KEY, { type: 'json' }));
  } catch (error) {
    if (error?.code === 'STORAGE_CONFIG_UNAVAILABLE') throw error;
    throw unavailable(error);
  }
}

async function writeCatalog(binding, items) {
  const catalog = Object.freeze({ schemaVersion: SCHEMA_VERSION, items });
  try {
    await binding.put(CATALOG_KEY, JSON.stringify(catalog));
  } catch (error) {
    throw unavailable(error);
  }
}

function assertConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw Object.assign(new Error('STORAGE_CONFIG_INVALID'), { code: 'STORAGE_CONFIG_INVALID', status: 400 });
  }
  if (Object.values(config).some((value) => typeof value !== 'string')) {
    throw Object.assign(new Error('STORAGE_CONFIG_INVALID'), { code: 'STORAGE_CONFIG_INVALID', status: 400 });
  }
  return config;
}

async function encryptConfig(env, type, configValue) {
  const config = { ...assertConfig(configValue) };
  for (const field of storageSecretFields(type)) {
    if (config[field]) config[field] = await encryptValue(env, config[field]);
  }
  return Object.freeze(config);
}

async function decryptConfig(env, type, configValue) {
  const config = { ...assertConfig(configValue) };
  for (const field of storageSecretFields(type)) {
    if (config[field]) config[field] = await decryptValue(env, config[field]);
  }
  return Object.freeze(config);
}

async function encodeItem(env, item) {
  return Object.freeze({ ...item, config: await encryptConfig(env, item.type, item.config) });
}

async function decodeItem(env, item) {
  return Object.freeze({ ...item, config: await decryptConfig(env, item.type, item.config) });
}

async function loadItems(env, binding) {
  const catalog = await readCatalog(binding);
  return Promise.all(catalog.items.map((item) => decodeItem(env, item)));
}

async function persistItems(env, binding, items) {
  const encoded = await Promise.all(items.map((item) => encodeItem(env, item)));
  await writeCatalog(binding, encoded);
}

function publicItem(item, includeSecrets) {
  return includeSecrets ? item : normalizeStorageItem(item);
}

function buildCreated(input) {
  const now = Date.now();
  const candidate = {
    id: `sc_${crypto.randomUUID()}`,
    name: input.name,
    type: input.type,
    enabled: input.enabled !== false,
    isDefault: Boolean(input.isDefault),
    config: assertConfig(input.config || {}),
    metadata: input.metadata || {},
    createdAt: now,
    updatedAt: now,
  };
  const normalized = normalizeStorageItem(candidate);
  return Object.freeze({ ...normalized, config: Object.freeze({ ...candidate.config }) });
}

function buildUpdated(current, patch) {
  const type = patch.type || current.type;
  const candidate = {
    ...current,
    name: patch.name ?? current.name,
    type,
    enabled: patch.enabled ?? current.enabled,
    isDefault: patch.isDefault ?? current.isDefault,
    config: mergeStorageConfig(type, current.config, patch.config || {}),
    metadata: patch.metadata ?? current.metadata,
    updatedAt: Date.now(),
  };
  const normalized = normalizeStorageItem(candidate);
  return Object.freeze({ ...normalized, config: Object.freeze({ ...candidate.config }) });
}

export function createStorageProfileRepository(env) {
  const binding = resolveStorageConfigBinding(env);
  return Object.freeze({
    async list(options = {}) {
      return (await loadItems(env, binding)).map((item) => publicItem(item, options.includeSecrets));
    },
    async get(id, options = {}) {
      const item = (await loadItems(env, binding)).find((entry) => entry.id === id);
      return item ? publicItem(item, options.includeSecrets) : null;
    },
    async create(input) {
      const items = await loadItems(env, binding);
      const created = buildCreated(input);
      const next = created.isDefault
        ? items.map((item) => Object.freeze({ ...item, isDefault: false })).concat(created)
        : items.concat(created);
      await persistItems(env, binding, next);
      return created;
    },
    async update(id, patch) {
      const items = await loadItems(env, binding);
      const current = items.find((item) => item.id === id);
      if (!current) return null;
      const updated = buildUpdated(current, patch);
      const next = items.map((item) => {
        if (item.id === id) return updated;
        return updated.isDefault ? Object.freeze({ ...item, isDefault: false }) : item;
      });
      await persistItems(env, binding, next);
      return updated;
    },
    async delete(id) {
      const items = await loadItems(env, binding);
      if (!items.some((item) => item.id === id)) return false;
      await persistItems(env, binding, items.filter((item) => item.id !== id));
      return true;
    },
    async setDefault(id) {
      const items = await loadItems(env, binding);
      if (!items.some((item) => item.id === id)) return null;
      const next = items.map((item) => Object.freeze({ ...item, isDefault: item.id === id }));
      await persistItems(env, binding, next);
      return next.find((item) => item.id === id);
    },
  });
}
