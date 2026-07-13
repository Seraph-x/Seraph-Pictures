import { probeCloudflareStorage } from '../status-probes.js';

const ENV_FIELDS = Object.freeze({
  telegram: Object.freeze({ botToken: 'TG_Bot_Token', chatId: 'TG_Chat_ID', apiBase: 'CUSTOM_BOT_API_URL' }),
  s3: Object.freeze({
    endpoint: 'S3_ENDPOINT', region: 'S3_REGION', bucket: 'S3_BUCKET',
    accessKeyId: 'S3_ACCESS_KEY_ID', secretAccessKey: 'S3_SECRET_ACCESS_KEY',
  }),
  discord: Object.freeze({ webhookUrl: 'DISCORD_WEBHOOK_URL', botToken: 'DISCORD_BOT_TOKEN', channelId: 'DISCORD_CHANNEL_ID' }),
  huggingface: Object.freeze({ token: 'HF_TOKEN', repo: 'HF_REPO' }),
  webdav: Object.freeze({
    baseUrl: 'WEBDAV_BASE_URL', username: 'WEBDAV_USERNAME', password: 'WEBDAV_PASSWORD',
    bearerToken: 'WEBDAV_BEARER_TOKEN', rootPath: 'WEBDAV_ROOT_PATH',
  }),
  github: Object.freeze({
    repo: 'GITHUB_REPO', token: 'GITHUB_TOKEN', mode: 'GITHUB_MODE', prefix: 'GITHUB_PREFIX',
    releaseTag: 'GITHUB_RELEASE_TAG', branch: 'GITHUB_BRANCH', apiBase: 'GITHUB_API_BASE',
  }),
  r2: Object.freeze({}),
});

function profileEnvironment(env, type, config) {
  const mapping = ENV_FIELDS[type];
  if (!mapping) throw Object.assign(new Error('STORAGE_BACKEND_UNSUPPORTED'), {
    code: 'STORAGE_BACKEND_UNSUPPORTED', status: 400,
  });
  const overrides = Object.fromEntries(Object.entries(mapping)
    .filter(([field]) => config[field])
    .map(([field, envName]) => [envName, String(config[field])]));
  return Object.freeze({ ...env, ...overrides });
}

export function testStorageProfile({ env, type, config }) {
  return probeCloudflareStorage({ type, env: profileEnvironment(env, type, config || {}) });
}
