function aliasSources(env, pick) {
  return Object.freeze({
    telegramToken: pick(env, ['TG_BOT_TOKEN', 'TG_Bot_Token']),
    telegramChat: pick(env, ['TG_CHAT_ID', 'TG_Chat_ID']),
    guestToken: pick(env, ['TG_GUEST_BOT_TOKEN']),
    guestChat: pick(env, ['TG_GUEST_CHAT_ID']),
    telegramApi: pick(env, ['CUSTOM_BOT_API_URL'], 'https://api.telegram.org'),
    huggingFaceToken: pick(env, ['HF_TOKEN', 'HUGGINGFACE_TOKEN', 'HF_API_TOKEN']),
    huggingFaceRepo: pick(env, ['HF_REPO', 'HUGGINGFACE_REPO', 'HF_DATASET_REPO']),
    githubToken: pick(env, ['GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_PAT']),
    githubRepo: pick(env, ['GITHUB_REPO', 'GH_REPO', 'GITHUB_REPOSITORY']),
  });
}

function telegramStorage(sources) {
  const apiBase = sources.telegramApi.value || 'https://api.telegram.org';
  return Object.freeze({
    telegram: {
      botToken: sources.telegramToken.value || '',
      chatId: sources.telegramChat.value || '',
      apiBase,
      envSource: {
        botToken: sources.telegramToken.source || 'none',
        chatId: sources.telegramChat.source || 'none',
        apiBase: sources.telegramApi.source || 'default',
      },
    },
    telegramGuest: {
      botToken: sources.guestToken.value || '',
      chatId: sources.guestChat.value || '',
      apiBase,
    },
  });
}

function objectStorage(env, normalize) {
  return Object.freeze({
    r2: {
      endpoint: normalize(env.R2_ENDPOINT) || normalize(env.S3_ENDPOINT) || '',
      region: normalize(env.R2_REGION) || normalize(env.S3_REGION) || 'auto',
      bucket: normalize(env.R2_BUCKET) || normalize(env.S3_BUCKET) || '',
      accessKeyId: normalize(env.R2_ACCESS_KEY_ID) || normalize(env.S3_ACCESS_KEY_ID) || '',
      secretAccessKey: normalize(env.R2_SECRET_ACCESS_KEY) || normalize(env.S3_SECRET_ACCESS_KEY) || '',
    },
    s3: {
      endpoint: normalize(env.S3_ENDPOINT),
      region: normalize(env.S3_REGION, 'us-east-1'),
      bucket: normalize(env.S3_BUCKET),
      accessKeyId: normalize(env.S3_ACCESS_KEY_ID),
      secretAccessKey: normalize(env.S3_SECRET_ACCESS_KEY),
    },
  });
}

function externalStorage(env, normalize, sources) {
  return Object.freeze({
    discord: {
      webhookUrl: normalize(env.DISCORD_WEBHOOK_URL),
      botToken: normalize(env.DISCORD_BOT_TOKEN),
      channelId: normalize(env.DISCORD_CHANNEL_ID),
    },
    huggingface: {
      token: sources.huggingFaceToken.value || '',
      repo: sources.huggingFaceRepo.value || '',
      envSource: {
        token: sources.huggingFaceToken.source || 'none',
        repo: sources.huggingFaceRepo.source || 'none',
      },
    },
    webdav: {
      baseUrl: normalize(env.WEBDAV_BASE_URL),
      username: normalize(env.WEBDAV_USERNAME),
      password: normalize(env.WEBDAV_PASSWORD),
      bearerToken: normalize(env.WEBDAV_BEARER_TOKEN) || normalize(env.WEBDAV_TOKEN) || '',
      rootPath: normalize(env.WEBDAV_ROOT_PATH),
    },
  });
}

function githubStorage(env, normalize, sources) {
  return Object.freeze({
    repo: sources.githubRepo.value || '',
    token: sources.githubToken.value || '',
    mode: normalize(env.GITHUB_MODE, 'releases').toLowerCase(),
    prefix: normalize(env.GITHUB_PREFIX) || normalize(env.GITHUB_PATH) || '',
    releaseTag: normalize(env.GITHUB_RELEASE_TAG),
    branch: normalize(env.GITHUB_BRANCH),
    apiBase: normalize(env.GITHUB_API_BASE, 'https://api.github.com'),
    envSource: {
      repo: sources.githubRepo.source || 'none',
      token: sources.githubToken.source || 'none',
    },
  });
}

function createStorageBootstrap(options) {
  const { env, normalize, pick } = options;
  const sources = aliasSources(env, pick);
  return Object.freeze({
    type: (env.DEFAULT_STORAGE_TYPE || 'telegram').toLowerCase(),
    ...telegramStorage(sources),
    ...objectStorage(env, normalize),
    ...externalStorage(env, normalize, sources),
    github: githubStorage(env, normalize, sources),
  });
}

module.exports = { createStorageBootstrap };
