export {
  describeStorageSchema,
  LEGACY_STORAGE_CONFIG_KEY as STORAGE_CONFIG_KEY,
  STORAGE_SCHEMA,
  STORAGE_TYPES,
} from './storage-config/schema.js';

export {
  readStorageConfig,
  resolveStorageEnv,
  writeStorageConfig,
} from './storage-config/resolver.js';
