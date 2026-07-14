import { createS3Client } from '../../utils/s3client.js';

const ENV_FIELDS = Object.freeze({
  telegram: Object.freeze({
    botToken: 'TG_Bot_Token', chatId: 'TG_Chat_ID', apiBase: 'CUSTOM_BOT_API_URL',
  }),
  s3: Object.freeze({
    endpoint: 'S3_ENDPOINT', region: 'S3_REGION', bucket: 'S3_BUCKET',
    accessKeyId: 'S3_ACCESS_KEY_ID', secretAccessKey: 'S3_SECRET_ACCESS_KEY',
  }),
  discord: Object.freeze({
    webhookUrl: 'DISCORD_WEBHOOK_URL', botToken: 'DISCORD_BOT_TOKEN',
    channelId: 'DISCORD_CHANNEL_ID',
  }),
  huggingface: Object.freeze({ token: 'HF_TOKEN', repo: 'HF_REPO' }),
  webdav: Object.freeze({
    baseUrl: 'WEBDAV_BASE_URL', username: 'WEBDAV_USERNAME', password: 'WEBDAV_PASSWORD',
    bearerToken: 'WEBDAV_BEARER_TOKEN', rootPath: 'WEBDAV_ROOT_PATH',
  }),
  github: Object.freeze({
    repo: 'GITHUB_REPO', token: 'GITHUB_TOKEN', mode: 'GITHUB_MODE',
    prefix: 'GITHUB_PREFIX', releaseTag: 'GITHUB_RELEASE_TAG', branch: 'GITHUB_BRANCH',
    apiBase: 'GITHUB_API_BASE',
  }),
});

function adapterError(code) {
  return Object.assign(new Error(code), { code, status: 500 });
}

function profileEnvironment(type, config) {
  const mapping = ENV_FIELDS[type];
  if (!mapping) throw adapterError('STORAGE_BACKEND_UNSUPPORTED');
  const entries = Object.entries(mapping)
    .filter(([field]) => config[field] !== undefined && config[field] !== '')
    .map(([field, name]) => [name, String(config[field])]);
  return Object.freeze(Object.fromEntries(entries));
}

function createR2Adapter({ profile, env, factories }) {
  if (profile.config.adapterMode === 'binding') {
    const binding = env[profile.config.bindingName];
    if (!binding) throw adapterError('STORAGE_PROFILE_INTEGRITY_ERROR');
    return Object.freeze({
      type: 'r2', profileId: profile.id, mode: 'binding', binding,
      environment: Object.freeze({}),
    });
  }
  const environment = profileEnvironment('s3', profile.config);
  return Object.freeze({
    type: 'r2', profileId: profile.id, mode: 's3', environment,
    client: factories.s3(environment),
  });
}

export function createStorageAdapter({ profile, env = {}, factories = {} }) {
  const resolvedFactories = Object.freeze({ s3: factories.s3 || createS3Client });
  if (profile.type === 'r2') return createR2Adapter({ profile, env, factories: resolvedFactories });
  const environment = profileEnvironment(profile.type, profile.config || {});
  return Object.freeze({
    type: profile.type,
    profileId: profile.id,
    mode: 'profile',
    environment,
    ...(profile.type === 's3' ? { client: resolvedFactories.s3(environment) } : {}),
  });
}
