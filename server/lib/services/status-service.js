const { toStorageErrorPayload } = require('../utils/storage-error');
const { testStatusConnection } = require('./status-connection');

const PROBE_TIMEOUT_MS = 5_000;
const PROBE_BATCH_SIZE = 3;
const SUPPORTED_TYPES = Object.freeze([
  'telegram', 'r2', 's3', 'discord', 'huggingface', 'webdav', 'github',
]);

function profileIdentity(config) {
  return Object.freeze({
    storageId: config.id,
    storageName: config.name,
    storageType: config.type,
  });
}

function emptyStatus(type) {
  return Object.freeze({
    connected: false,
    enabled: false,
    configured: false,
    layer: type === 'webdav' ? 'mounted' : 'direct',
    message: 'Not configured',
  });
}

function disabledStatus(config) {
  return Object.freeze({
    ...profileIdentity(config),
    connected: false,
    enabled: false,
    configured: true,
    layer: config.type === 'webdav' ? 'mounted' : 'direct',
    message: `Configured (${config.name}) but disabled`,
    configName: config.name,
  });
}

function probeResult(config, result, formatDetail) {
  const detail = formatDetail(result?.detail || result?.raw || '');
  const errorModel = result?.connected
    ? undefined
    : toStorageErrorPayload(detail || 'Connection failed', result?.status);
  return Object.freeze({
    ...profileIdentity(config),
    connected: Boolean(result?.connected),
    enabled: true,
    configured: true,
    layer: config.type === 'webdav' ? 'mounted' : 'direct',
    message: result?.connected
      ? `Connected (${config.name})`
      : (detail ? `Connection failed: ${detail}` : 'Connection failed'),
    errorModel,
    configName: config.name,
  });
}

function failedStatus(config, error) {
  const errorModel = toStorageErrorPayload(error);
  return Object.freeze({
    ...profileIdentity(config),
    connected: false,
    enabled: true,
    configured: true,
    layer: config.type === 'webdav' ? 'mounted' : 'direct',
    message: `Connection error: ${errorModel.detail}`,
    errorModel,
    configName: config.name,
  });
}

async function withTimeout(operation) {
  const controller = new AbortController();
  let timeout;
  const deadline = new Promise((resolve, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new Error('Connection check timed out'));
    }, PROBE_TIMEOUT_MS);
  });
  try {
    return await Promise.race([operation(controller.signal), deadline]);
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}

async function probeConfig(options) {
  const { config, storageFactory, formatDetail } = options;
  if (!config.enabled) return disabledStatus(config);
  try {
    const adapter = storageFactory.createAdapter(config);
    const result = await withTimeout((signal) => testStatusConnection({
      type: config.type, adapter, signal,
    }));
    return probeResult(config, result, formatDetail);
  } catch (error) {
    return failedStatus(config, error);
  }
}

async function probeBatches(options) {
  const output = [];
  for (let index = 0; index < options.configs.length; index += PROBE_BATCH_SIZE) {
    const batch = options.configs.slice(index, index + PROBE_BATCH_SIZE);
    const results = await Promise.all(batch.map((config) => probeConfig({
      config,
      storageFactory: options.storageFactory,
      formatDetail: options.formatDetail,
    })));
    output.push(...results);
  }
  return Object.freeze(output);
}

function capabilities() {
  return Object.freeze([
    ['telegram', 'Telegram', 'Create a Telegram storage profile in Storage Config.'],
    ['r2', 'Cloudflare R2', 'Create an R2 profile with endpoint/bucket/keys.'],
    ['s3', 'S3 Compatible', 'Create an S3 profile with endpoint/region/bucket/keys.'],
    ['discord', 'Discord', 'Create a Discord webhook or bot profile.'],
    ['huggingface', 'HuggingFace', 'Create a HuggingFace profile with token + dataset repo.'],
    ['github', 'GitHub', 'Create a GitHub profile in Releases or Contents mode.'],
    ['webdav', 'WebDAV (Mounted)', 'Configure a mounted WebDAV endpoint.'],
  ].map(([type, label, enableHint]) => Object.freeze({
    type, label, enableHint, layer: type === 'webdav' ? 'mounted' : 'direct',
  })));
}

function selectProbeConfigs(configs) {
  return Object.freeze(configs.filter((config) => SUPPORTED_TYPES.includes(config.type)));
}

function defaultProfileStatus(type, configs, statuses) {
  const candidates = configs.filter((config) => config.type === type);
  const selected = candidates.find((config) => config.isDefault) || candidates[0];
  if (!selected) return emptyStatus(type);
  return statuses.find((status) => status.storageId === selected.id) || emptyStatus(type);
}

function telegramDiagnostics(config, status, bootstrap) {
  if (!config) {
    const source = bootstrap?.envSource || {};
    return Object.freeze({
      summary: 'Telegram storage profile is not created yet.',
      configName: '',
      configSource: 'not-configured',
      tokenSource: source.botToken || 'not found',
      chatIdSource: source.chatId || 'not found',
      apiBaseSource: source.apiBase || 'default',
      hasToken: Boolean(bootstrap?.botToken),
      hasChatId: Boolean(bootstrap?.chatId),
    });
  }
  const source = config.metadata?.envSource || bootstrap?.envSource || {};
  return Object.freeze({
    summary: status.connected ? 'Telegram adapter is connected.' : status.message,
    configName: config.name || '',
    configSource: config.metadata?.source || 'dynamic-storage-config',
    tokenSource: source.botToken || 'configured in storage profile',
    chatIdSource: source.chatId || 'configured in storage profile',
    apiBaseSource: source.apiBase || 'configured in storage profile',
    hasToken: Boolean(config.config?.botToken),
    hasChatId: Boolean(config.config?.chatId),
  });
}

async function collectDockerStatus(options) {
  const configs = selectProbeConfigs(options.services.storageRepo.list(true));
  const storageProfiles = await probeBatches({
    configs,
    storageFactory: options.services.storageFactory,
    formatDetail: options.formatDetail,
  });
  const status = {};
  for (const type of SUPPORTED_TYPES) {
    status[type] = defaultProfileStatus(type, configs, storageProfiles);
  }
  const telegramConfigs = configs.filter((config) => config.type === 'telegram');
  const telegram = telegramConfigs.find((config) => config.isDefault) || telegramConfigs[0] || null;
  return Object.freeze({
    ...status,
    storageProfiles,
    kv: Object.freeze({ connected: true, message: 'SQLite metadata storage enabled' }),
    auth: Object.freeze({ enabled: true, message: 'Password auth enabled' }),
    guestUpload: options.services.guestService.getConfig(),
    uploadLimits: options.uploadLimits,
    settings: await options.services.settingsStore.healthCheck(),
    diagnostics: Object.freeze({
      telegram: telegramDiagnostics(
        telegram,
        status.telegram,
        options.config.bootstrapDefaultStorage?.telegram,
      ),
    }),
    capabilities: capabilities(),
  });
}

module.exports = { collectDockerStatus, selectProbeConfigs };
