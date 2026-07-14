import contractModule from '../../../shared/storage/contracts.cjs';
import { decryptValue, encryptValue } from '../../utils/storage-config/crypto.js';

const { storageSecretFields } = contractModule;

function assertConfig(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw Object.assign(new Error('STORAGE_CONFIG_INVALID'), {
      code: 'STORAGE_CONFIG_INVALID', status: 400,
    });
  }
  if (Object.values(value).some((entry) => typeof entry !== 'string')) {
    throw Object.assign(new Error('STORAGE_CONFIG_INVALID'), {
      code: 'STORAGE_CONFIG_INVALID', status: 400,
    });
  }
  return value;
}

async function transformSecrets({ env, type, config, transform }) {
  const output = { ...assertConfig(config) };
  for (const field of storageSecretFields(type)) {
    if (output[field]) output[field] = await transform(env, output[field]);
  }
  return Object.freeze(output);
}

export function encodeProfile(env, profile) {
  return transformSecrets({
    env, type: profile.type, config: profile.config, transform: encryptValue,
  }).then((config) => Object.freeze({ ...profile, config }));
}

export function decodeProfile(env, profile) {
  return transformSecrets({
    env, type: profile.type, config: profile.config, transform: decryptValue,
  }).then((config) => Object.freeze({ ...profile, config }));
}
