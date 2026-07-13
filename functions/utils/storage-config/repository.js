import {
  LEGACY_STORAGE_CONFIG_KEY,
  versionedStorageConfigKey,
} from './schema.js';
import { unavailable } from './errors.js';

const KV_BINDING_CANDIDATES = Object.freeze(['img_url', 'KV', 'UI_CONFIG_KV']);

export function resolveStorageConfigBinding(env) {
  for (const name of KV_BINDING_CANDIDATES) {
    const binding = env?.[name];
    if (binding?.get && binding?.put) return binding;
  }
  throw unavailable(new Error('KV binding is unavailable.'));
}

async function readJson(binding, key) {
  try {
    const value = await binding.get(key, { type: 'json' });
    if (value === null) return Object.freeze({ kind: 'absent' });
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid KV JSON.');
    return Object.freeze({ kind: 'value', value });
  } catch (error) {
    throw unavailable(error);
  }
}

export function createStorageConfigRepository(env) {
  const binding = resolveStorageConfigBinding(env);
  return Object.freeze({
    readLegacy: () => readJson(binding, LEGACY_STORAGE_CONFIG_KEY),
    readVersion: (version) => readJson(binding, versionedStorageConfigKey(version)),
    async writeVersion(version, record) {
      try {
        await binding.put(versionedStorageConfigKey(version), JSON.stringify(record));
      } catch (error) {
        throw unavailable(error);
      }
    },
  });
}
