/**
 * Runtime-editable storage configuration for the Cloudflare Pages runtime.
 *
 * Storage credentials normally come from env bindings/secrets, which are
 * read-only at runtime. This module stores an optional override in KV
 * (key "storage_config") so an admin can edit backends from the browser.
 * Secret fields are encrypted with AES-GCM before they touch KV.
 *
 * Resolution order at upload/read time: KV value (when set) wins, otherwise
 * fall back to the env binding/secret. R2 is intentionally excluded — it is a
 * bound bucket, not an env credential, so it cannot be edited from a page.
 */

const STORAGE_CONFIG_KEY = 'storage_config';
const KV_BINDING_CANDIDATES = ['img_url', 'KV', 'UI_CONFIG_KV'];
const ENC_PREFIX = 'enc:v1:';

// Per-backend fields. `env` is the variable name each existing reader expects
// (so an override is just `{ ...env, [field.env]: value }`). `secret: true`
// fields are encrypted in KV and masked on read.
//
// Guest variants (`*Guest`) hold a separate channel so guest abuse cannot get
// the main channel banned. Only the Telegram guest channel is consumed at
// runtime today (getTelegramCreds(env, { guest: true })); the other guest
// variants persist config now but are not yet wired into uploads, which remain
// Telegram-only for guests. When unconfigured, guests fall back to the main
// channel for that backend.
const STORAGE_SCHEMA = {
  // Main Telegram bot/channel (admin uploads). Reader: getTelegramCreds(env).
  telegram: [
    { key: 'botToken', env: 'TG_Bot_Token', secret: true, label: 'Bot Token' },
    { key: 'chatId', env: 'TG_Chat_ID', label: 'Chat ID' },
    { key: 'apiBaseUrl', env: 'CUSTOM_BOT_API_URL', label: 'API Base URL' },
  ],
  // Separate guest channel so guest abuse cannot get the main bot banned.
  // Reader: getTelegramCreds(env, { guest: true }). Kept distinct on purpose.
  telegramGuest: [
    { key: 'botToken', env: 'TG_GUEST_BOT_TOKEN', secret: true, label: 'Bot Token' },
    { key: 'chatId', env: 'TG_GUEST_CHAT_ID', label: 'Chat ID' },
  ],
  webdav: [
    { key: 'baseUrl', env: 'WEBDAV_BASE_URL', label: 'Base URL' },
    { key: 'username', env: 'WEBDAV_USERNAME', label: 'Username' },
    { key: 'password', env: 'WEBDAV_PASSWORD', secret: true, label: 'Password' },
    { key: 'bearerToken', env: 'WEBDAV_BEARER_TOKEN', secret: true, label: 'Bearer Token' },
    { key: 'rootPath', env: 'WEBDAV_ROOT_PATH', label: 'Root Path' },
  ],
  webdavGuest: [
    { key: 'baseUrl', env: 'WEBDAV_GUEST_BASE_URL', label: 'Base URL' },
    { key: 'username', env: 'WEBDAV_GUEST_USERNAME', label: 'Username' },
    { key: 'password', env: 'WEBDAV_GUEST_PASSWORD', secret: true, label: 'Password' },
    { key: 'bearerToken', env: 'WEBDAV_GUEST_BEARER_TOKEN', secret: true, label: 'Bearer Token' },
    { key: 'rootPath', env: 'WEBDAV_GUEST_ROOT_PATH', label: 'Root Path' },
  ],
  discord: [
    { key: 'webhookUrl', env: 'DISCORD_WEBHOOK_URL', secret: true, label: 'Webhook URL' },
    { key: 'botToken', env: 'DISCORD_BOT_TOKEN', secret: true, label: 'Bot Token' },
    { key: 'channelId', env: 'DISCORD_CHANNEL_ID', label: 'Channel ID' },
  ],
  discordGuest: [
    { key: 'webhookUrl', env: 'DISCORD_GUEST_WEBHOOK_URL', secret: true, label: 'Webhook URL' },
    { key: 'botToken', env: 'DISCORD_GUEST_BOT_TOKEN', secret: true, label: 'Bot Token' },
    { key: 'channelId', env: 'DISCORD_GUEST_CHANNEL_ID', label: 'Channel ID' },
  ],
  github: [
    { key: 'repo', env: 'GITHUB_REPO', label: 'Repo (owner/name)' },
    { key: 'token', env: 'GITHUB_TOKEN', secret: true, label: 'Token' },
    { key: 'mode', env: 'GITHUB_MODE', label: 'Mode (releases/contents)' },
    { key: 'prefix', env: 'GITHUB_PREFIX', label: 'Prefix' },
    { key: 'releaseTag', env: 'GITHUB_RELEASE_TAG', label: 'Release Tag' },
    { key: 'branch', env: 'GITHUB_BRANCH', label: 'Branch' },
    { key: 'apiBase', env: 'GITHUB_API_BASE', label: 'API Base' },
  ],
  githubGuest: [
    { key: 'repo', env: 'GITHUB_GUEST_REPO', label: 'Repo (owner/name)' },
    { key: 'token', env: 'GITHUB_GUEST_TOKEN', secret: true, label: 'Token' },
    { key: 'mode', env: 'GITHUB_GUEST_MODE', label: 'Mode (releases/contents)' },
    { key: 'prefix', env: 'GITHUB_GUEST_PREFIX', label: 'Prefix' },
    { key: 'releaseTag', env: 'GITHUB_GUEST_RELEASE_TAG', label: 'Release Tag' },
    { key: 'branch', env: 'GITHUB_GUEST_BRANCH', label: 'Branch' },
    { key: 'apiBase', env: 'GITHUB_GUEST_API_BASE', label: 'API Base' },
  ],
  huggingface: [
    { key: 'token', env: 'HF_TOKEN', secret: true, label: 'Token' },
    { key: 'repo', env: 'HF_REPO', label: 'Repo' },
  ],
  huggingfaceGuest: [
    { key: 'token', env: 'HF_GUEST_TOKEN', secret: true, label: 'Token' },
    { key: 'repo', env: 'HF_GUEST_REPO', label: 'Repo' },
  ],
  s3: [
    { key: 'endpoint', env: 'S3_ENDPOINT', label: 'Endpoint' },
    { key: 'region', env: 'S3_REGION', label: 'Region' },
    { key: 'bucket', env: 'S3_BUCKET', label: 'Bucket' },
    { key: 'accessKeyId', env: 'S3_ACCESS_KEY_ID', label: 'Access Key ID' },
    { key: 'secretAccessKey', env: 'S3_SECRET_ACCESS_KEY', secret: true, label: 'Secret Access Key' },
  ],
  s3Guest: [
    { key: 'endpoint', env: 'S3_GUEST_ENDPOINT', label: 'Endpoint' },
    { key: 'region', env: 'S3_GUEST_REGION', label: 'Region' },
    { key: 'bucket', env: 'S3_GUEST_BUCKET', label: 'Bucket' },
    { key: 'accessKeyId', env: 'S3_GUEST_ACCESS_KEY_ID', label: 'Access Key ID' },
    { key: 'secretAccessKey', env: 'S3_GUEST_SECRET_ACCESS_KEY', secret: true, label: 'Secret Access Key' },
  ],
};

// Display metadata used by the settings page (data-driven UI). `enabled: false`
// guest variants persist config but are not yet consumed at runtime.
const STORAGE_TYPE_META = {
  telegram: { label: 'Telegram', group: 'telegram', guest: false, enabled: true },
  telegramGuest: { label: 'Telegram (访客通道)', group: 'telegram', guest: true, enabled: true },
  webdav: { label: 'WebDAV', group: 'webdav', guest: false, enabled: true },
  webdavGuest: { label: 'WebDAV (访客通道·预留)', group: 'webdav', guest: true, enabled: false },
  discord: { label: 'Discord', group: 'discord', guest: false, enabled: true },
  discordGuest: { label: 'Discord (访客通道·预留)', group: 'discord', guest: true, enabled: false },
  github: { label: 'GitHub', group: 'github', guest: false, enabled: true },
  githubGuest: { label: 'GitHub (访客通道·预留)', group: 'github', guest: true, enabled: false },
  huggingface: { label: 'HuggingFace', group: 'huggingface', guest: false, enabled: true },
  huggingfaceGuest: { label: 'HuggingFace (访客通道·预留)', group: 'huggingface', guest: true, enabled: false },
  s3: { label: 'S3', group: 's3', guest: false, enabled: true },
  s3Guest: { label: 'S3 (访客通道·预留)', group: 's3', guest: true, enabled: false },
};

const STORAGE_TYPES = Object.keys(STORAGE_SCHEMA);

/**
 * A serializable description of the schema for the settings page so the UI
 * stays in sync with the backend (single source of truth). Secret values are
 * never included here — only field shape and display metadata.
 */
export function describeStorageSchema() {
  return STORAGE_TYPES.map((type) => ({
    type,
    ...STORAGE_TYPE_META[type],
    fields: STORAGE_SCHEMA[type].map((field) => ({
      key: field.key,
      label: field.label || field.key,
      secret: Boolean(field.secret),
    })),
  }));
}

function resolveKvBinding(env = {}) {
  for (const name of KV_BINDING_CANDIDATES) {
    const candidate = env?.[name];
    if (candidate && typeof candidate.get === 'function' && typeof candidate.put === 'function') {
      return { name, binding: candidate };
    }
  }
  return null;
}

function getEncryptionSecret(env = {}) {
  const secret = env?.CONFIG_ENCRYPTION_KEY || env?.SESSION_SECRET || '';
  return String(secret || '').trim();
}

function bytesToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(String(value || ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function importAesKey(env) {
  const secret = getEncryptionSecret(env);
  if (!secret) return null;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith(ENC_PREFIX);
}

async function encryptValue(env, plaintext) {
  const key = await importAesKey(env);
  if (!key) {
    const error = new Error('Encryption key is not configured (set CONFIG_ENCRYPTION_KEY or SESSION_SECRET).');
    error.code = 'NO_ENC_KEY';
    throw error;
  }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(String(plaintext))
  );
  return `${ENC_PREFIX}${bytesToBase64(iv)}:${bytesToBase64(new Uint8Array(ciphertext))}`;
}

async function decryptValue(env, stored) {
  if (!isEncrypted(stored)) return String(stored || '');
  const key = await importAesKey(env);
  if (!key) return '';
  try {
    const [ivPart, dataPart] = String(stored).slice(ENC_PREFIX.length).split(':');
    const iv = base64ToBytes(ivPart);
    const data = base64ToBytes(dataPart);
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
    return new TextDecoder().decode(plaintext);
  } catch (error) {
    console.error('[storage-config] Failed to decrypt a secret field:', error?.message || String(error));
    return '';
  }
}

async function loadRawConfig(env) {
  const kv = resolveKvBinding(env);
  if (!kv) return {};
  try {
    const saved = await kv.binding.get(STORAGE_CONFIG_KEY, { type: 'json' });
    return saved && typeof saved === 'object' ? saved : {};
  } catch (error) {
    console.error('[storage-config] Failed to read config from KV:', error?.message || String(error));
    return {};
  }
}

function normalizeFieldValue(value) {
  return String(value == null ? '' : value).trim();
}

/**
 * Read the stored config for the settings UI. Secret fields are never returned;
 * instead `secretsPresent[type][key] = true` signals the field already has a
 * stored value so the UI can show a "leave blank to keep" placeholder.
 */
export async function readStorageConfig(env) {
  const raw = await loadRawConfig(env);
  const config = {};
  const secretsPresent = {};

  for (const type of STORAGE_TYPES) {
    config[type] = {};
    secretsPresent[type] = {};
    const stored = raw[type] && typeof raw[type] === 'object' ? raw[type] : {};
    for (const field of STORAGE_SCHEMA[type]) {
      const value = stored[field.key];
      if (field.secret) {
        config[type][field.key] = '';
        secretsPresent[type][field.key] = Boolean(value);
      } else {
        config[type][field.key] = normalizeFieldValue(value);
      }
    }
  }

  return { config, secretsPresent };
}

/**
 * Merge an incoming patch into the stored config and persist it.
 * Secret fields: a non-empty value replaces (and is re-encrypted); an empty
 * value preserves the existing secret. Non-secret fields are set verbatim.
 */
export async function writeStorageConfig(env, patch = {}) {
  const kv = resolveKvBinding(env);
  if (!kv) {
    const error = new Error('No KV namespace binding is available.');
    error.code = 'KV_BINDING_MISSING';
    throw error;
  }

  const raw = await loadRawConfig(env);
  const next = {};

  for (const type of STORAGE_TYPES) {
    const current = raw[type] && typeof raw[type] === 'object' ? raw[type] : {};
    const incoming = patch[type] && typeof patch[type] === 'object' ? patch[type] : {};
    next[type] = {};

    for (const field of STORAGE_SCHEMA[type]) {
      const hasIncoming = Object.prototype.hasOwnProperty.call(incoming, field.key);
      const incomingValue = hasIncoming ? normalizeFieldValue(incoming[field.key]) : '';

      if (field.secret) {
        if (incomingValue) {
          next[type][field.key] = await encryptValue(env, incomingValue);
        } else if (current[field.key]) {
          next[type][field.key] = current[field.key];
        }
      } else if (hasIncoming) {
        if (incomingValue) next[type][field.key] = incomingValue;
      } else if (current[field.key]) {
        next[type][field.key] = current[field.key];
      }
    }
  }

  next.version = 1;
  await kv.binding.put(STORAGE_CONFIG_KEY, JSON.stringify(next));
  return readStorageConfig(env);
}

/**
 * Overlay any stored config onto `env` so existing readers
 * (getWebDAVConfig, getTelegramCreds, createS3Client, ...) pick it up.
 * Fails open: on any error the original env is returned unchanged.
 */
export async function resolveStorageEnv(env = {}) {
  try {
    const raw = await loadRawConfig(env);
    if (!raw || typeof raw !== 'object') return env;

    const overrides = {};
    for (const type of STORAGE_TYPES) {
      const stored = raw[type] && typeof raw[type] === 'object' ? raw[type] : null;
      if (!stored) continue;
      for (const field of STORAGE_SCHEMA[type]) {
        const value = stored[field.key];
        if (value == null || value === '') continue;
        const resolved = field.secret ? await decryptValue(env, value) : String(value);
        if (resolved !== '') overrides[field.env] = resolved;
      }
    }

    if (Object.keys(overrides).length === 0) return env;
    return { ...env, ...overrides };
  } catch (error) {
    console.error('[storage-config] resolveStorageEnv failed, falling back to env:', error?.message || String(error));
    return env;
  }
}

export { STORAGE_SCHEMA, STORAGE_TYPES, STORAGE_CONFIG_KEY };
