import { callAuthCoordinator } from '../../utils/auth/coordinator-client.js';
import { unavailable } from '../../utils/storage-config/errors.js';
import { resolveStorageConfigBinding } from '../../utils/storage-config/repository.js';

const LEGACY_KEY = 'storage_profiles:v1';
const GENERATION_PREFIX = 'storage_profiles:v2:';
const SCHEMA_VERSION = 2;

function emptyCatalog() {
  return Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    generation: null,
    items: Object.freeze([]),
    legacyTypeProfileIds: Object.freeze({}),
  });
}

function validateCatalog(value, generation) {
  const valid = value?.schemaVersion === SCHEMA_VERSION
    && value?.generation === generation
    && Array.isArray(value?.items)
    && value?.legacyTypeProfileIds
    && typeof value.legacyTypeProfileIds === 'object';
  if (!valid) throw unavailable(new Error('Storage profile generation is invalid.'));
  return Object.freeze(value);
}

function validateLegacy(value) {
  if (value === null) return null;
  if (value?.schemaVersion !== 1 || !Array.isArray(value?.items)) {
    throw unavailable(new Error('Legacy storage profile catalog is invalid.'));
  }
  return Object.freeze(value);
}

async function callAuthority(env, operation, payload = {}) {
  try {
    return await callAuthCoordinator(env, operation, payload);
  } catch (error) {
    throw unavailable(error);
  }
}

export function createStorageCatalogStore(env) {
  const binding = resolveStorageConfigBinding(env);
  return Object.freeze({
    async readLegacy() {
      try {
        return validateLegacy(await binding.get(LEGACY_KEY, { type: 'json' }));
      } catch (error) {
        if (error?.code === 'STORAGE_CONFIG_UNAVAILABLE') throw error;
        throw unavailable(error);
      }
    },
    async readActive() {
      const authority = await callAuthority(env, 'storageProfileCatalogReadAuthority');
      if (!authority.initialized) return emptyCatalog();
      try {
        const value = await binding.get(`${GENERATION_PREFIX}${authority.generation}`, { type: 'json' });
        return validateCatalog(value, authority.generation);
      } catch (error) {
        if (error?.code === 'STORAGE_CONFIG_UNAVAILABLE') throw error;
        throw unavailable(error);
      }
    },
    async stage(catalog) {
      const key = `${GENERATION_PREFIX}${catalog.generation}`;
      try {
        await binding.put(key, JSON.stringify(catalog));
        return validateCatalog(await binding.get(key, { type: 'json' }), catalog.generation);
      } catch (error) {
        if (error?.code === 'STORAGE_CONFIG_UNAVAILABLE') throw error;
        throw unavailable(error);
      }
    },
    activate(options) {
      return callAuthority(env, 'storageProfileCatalogActivate', options);
    },
  });
}
