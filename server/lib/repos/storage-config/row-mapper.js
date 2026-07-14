const { decryptJson } = require('../../utils/crypto');
const { presentProfile } = require('../../../../shared/storage/profile-policy.cjs');

function parseJson(value, fallback = {}) {
  if (!value) return fallback;
  return JSON.parse(value);
}

function decryptConfig({ row, encryptionKey }) {
  try {
    return decryptJson(parseJson(row.encrypted_payload), encryptionKey);
  } catch (error) {
    const wrapped = new Error(
      `Failed to decrypt storage config "${row.name}". Check CONFIG_ENCRYPTION_KEY.`,
      { cause: error },
    );
    wrapped.code = 'STORAGE_PROFILE_INTEGRITY_ERROR';
    throw wrapped;
  }
}

function mapStorageRow({ row, encryptionKey, includeSecrets = false }) {
  if (!row) return null;
  const profile = Object.freeze({
    id: row.id,
    name: row.name,
    type: row.type,
    enabled: Boolean(row.enabled),
    isDefault: Boolean(row.is_default),
    metadata: Object.freeze({ ...parseJson(row.metadata_json) }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    config: Object.freeze({ ...decryptConfig({ row, encryptionKey }) }),
  });
  return includeSecrets ? profile : presentProfile(profile);
}

module.exports = { mapStorageRow };
