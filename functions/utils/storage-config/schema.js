export const LEGACY_STORAGE_CONFIG_KEY = 'storage_config';
export const STORAGE_CONFIG_SCHEMA_VERSION = 1;

export const STORAGE_SCHEMA = Object.freeze({
  telegram: Object.freeze([
    { key: 'botToken', env: 'TG_Bot_Token', secret: true, label: 'Bot Token' },
    { key: 'chatId', env: 'TG_Chat_ID', label: 'Chat ID' },
    { key: 'apiBaseUrl', env: 'CUSTOM_BOT_API_URL', label: 'API Base URL' },
  ]),
  telegramGuest: Object.freeze([
    { key: 'botToken', env: 'TG_GUEST_BOT_TOKEN', secret: true, label: 'Bot Token' },
    { key: 'chatId', env: 'TG_GUEST_CHAT_ID', label: 'Chat ID' },
  ]),
  webdav: Object.freeze([
    { key: 'baseUrl', env: 'WEBDAV_BASE_URL', label: 'Base URL' },
    { key: 'username', env: 'WEBDAV_USERNAME', label: 'Username' },
    { key: 'password', env: 'WEBDAV_PASSWORD', secret: true, label: 'Password' },
    { key: 'bearerToken', env: 'WEBDAV_BEARER_TOKEN', secret: true, label: 'Bearer Token' },
    { key: 'rootPath', env: 'WEBDAV_ROOT_PATH', label: 'Root Path' },
  ]),
  webdavGuest: Object.freeze([
    { key: 'baseUrl', env: 'WEBDAV_GUEST_BASE_URL', label: 'Base URL' },
    { key: 'username', env: 'WEBDAV_GUEST_USERNAME', label: 'Username' },
    { key: 'password', env: 'WEBDAV_GUEST_PASSWORD', secret: true, label: 'Password' },
    { key: 'bearerToken', env: 'WEBDAV_GUEST_BEARER_TOKEN', secret: true, label: 'Bearer Token' },
    { key: 'rootPath', env: 'WEBDAV_GUEST_ROOT_PATH', label: 'Root Path' },
  ]),
  discord: Object.freeze([
    { key: 'webhookUrl', env: 'DISCORD_WEBHOOK_URL', secret: true, label: 'Webhook URL' },
    { key: 'botToken', env: 'DISCORD_BOT_TOKEN', secret: true, label: 'Bot Token' },
    { key: 'channelId', env: 'DISCORD_CHANNEL_ID', label: 'Channel ID' },
  ]),
  discordGuest: Object.freeze([
    { key: 'webhookUrl', env: 'DISCORD_GUEST_WEBHOOK_URL', secret: true, label: 'Webhook URL' },
    { key: 'botToken', env: 'DISCORD_GUEST_BOT_TOKEN', secret: true, label: 'Bot Token' },
    { key: 'channelId', env: 'DISCORD_GUEST_CHANNEL_ID', label: 'Channel ID' },
  ]),
  github: Object.freeze([
    { key: 'repo', env: 'GITHUB_REPO', label: 'Repo (owner/name)' },
    { key: 'token', env: 'GITHUB_TOKEN', secret: true, label: 'Token' },
    { key: 'mode', env: 'GITHUB_MODE', label: 'Mode (releases/contents)' },
    { key: 'prefix', env: 'GITHUB_PREFIX', label: 'Prefix' },
    { key: 'releaseTag', env: 'GITHUB_RELEASE_TAG', label: 'Release Tag' },
    { key: 'branch', env: 'GITHUB_BRANCH', label: 'Branch' },
    { key: 'apiBase', env: 'GITHUB_API_BASE', label: 'API Base' },
  ]),
  githubGuest: Object.freeze([
    { key: 'repo', env: 'GITHUB_GUEST_REPO', label: 'Repo (owner/name)' },
    { key: 'token', env: 'GITHUB_GUEST_TOKEN', secret: true, label: 'Token' },
    { key: 'mode', env: 'GITHUB_GUEST_MODE', label: 'Mode (releases/contents)' },
    { key: 'prefix', env: 'GITHUB_GUEST_PREFIX', label: 'Prefix' },
    { key: 'releaseTag', env: 'GITHUB_GUEST_RELEASE_TAG', label: 'Release Tag' },
    { key: 'branch', env: 'GITHUB_GUEST_BRANCH', label: 'Branch' },
    { key: 'apiBase', env: 'GITHUB_GUEST_API_BASE', label: 'API Base' },
  ]),
  huggingface: Object.freeze([
    { key: 'token', env: 'HF_TOKEN', secret: true, label: 'Token' },
    { key: 'repo', env: 'HF_REPO', label: 'Repo' },
  ]),
  huggingfaceGuest: Object.freeze([
    { key: 'token', env: 'HF_GUEST_TOKEN', secret: true, label: 'Token' },
    { key: 'repo', env: 'HF_GUEST_REPO', label: 'Repo' },
  ]),
  s3: Object.freeze([
    { key: 'endpoint', env: 'S3_ENDPOINT', label: 'Endpoint' },
    { key: 'region', env: 'S3_REGION', label: 'Region' },
    { key: 'bucket', env: 'S3_BUCKET', label: 'Bucket' },
    { key: 'accessKeyId', env: 'S3_ACCESS_KEY_ID', label: 'Access Key ID' },
    { key: 'secretAccessKey', env: 'S3_SECRET_ACCESS_KEY', secret: true, label: 'Secret Access Key' },
  ]),
  s3Guest: Object.freeze([
    { key: 'endpoint', env: 'S3_GUEST_ENDPOINT', label: 'Endpoint' },
    { key: 'region', env: 'S3_GUEST_REGION', label: 'Region' },
    { key: 'bucket', env: 'S3_GUEST_BUCKET', label: 'Bucket' },
    { key: 'accessKeyId', env: 'S3_GUEST_ACCESS_KEY_ID', label: 'Access Key ID' },
    { key: 'secretAccessKey', env: 'S3_GUEST_SECRET_ACCESS_KEY', secret: true, label: 'Secret Access Key' },
  ]),
});

const TYPE_META = Object.freeze({
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
});

export const STORAGE_TYPES = Object.freeze(Object.keys(STORAGE_SCHEMA));

export function describeStorageSchema() {
  return STORAGE_TYPES.map((type) => Object.freeze({
    type,
    ...TYPE_META[type],
    fields: STORAGE_SCHEMA[type].map((field) => Object.freeze({
      key: field.key,
      label: field.label || field.key,
      secret: Boolean(field.secret),
    })),
  }));
}

export function versionedStorageConfigKey(version) {
  return `${LEGACY_STORAGE_CONFIG_KEY}:v${version}`;
}
