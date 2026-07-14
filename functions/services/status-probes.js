import { createS3Client } from '../utils/s3client.js';
import { checkDiscordConnection } from '../utils/discord.js';
import { checkHuggingFaceConnection, hasHuggingFaceConfig } from '../utils/huggingface.js';
import { checkWebDAVConnection, hasWebDAVConfig } from '../utils/webdav.js';
import { checkGitHubConnection, hasGitHubConfig } from '../utils/github.js';
import { getGuestConfig } from '../utils/guest.js';
import { buildTelegramBotApiUrl, getTelegramApiBase } from '../utils/telegram.js';
import capabilityModule from '../../shared/storage/capabilities.cjs';
import { createStorageProfileRepository } from './storage-profiles/repository.js';
import { createStorageAdapter } from './storage-runtime/adapter-factory.js';

const PROBE_TIMEOUT_MS = 5_000;
const PROBE_BATCH_SIZE = 3;
const STORAGE_TYPES = Object.freeze([
  'telegram', 'r2', 's3', 'discord', 'huggingface', 'webdav', 'github',
]);
const { resolveCapability } = capabilityModule;

function empty(layer = 'direct') {
  return Object.freeze({
    connected: false, enabled: false, configured: false, layer, message: 'Not configured',
  });
}

function connected(message, extra = {}) {
  return Object.freeze({
    connected: true, enabled: true, configured: true, layer: 'direct', message, ...extra,
  });
}

function failed(message, layer = 'direct') {
  return Object.freeze({
    connected: false, enabled: true, configured: true, layer, message,
  });
}

function uploadLimits() {
  return Object.freeze(Object.fromEntries(STORAGE_TYPES.map((type) => {
    const capability = resolveCapability({ runtime: 'cloudflare', type });
    const supportsChunkUpload = capability.modes.includes('multipart');
    return [type, Object.freeze({
      maxBytes: capability.maxBytes,
      directThreshold: supportsChunkUpload ? capability.directThreshold : capability.maxBytes,
      supportsChunkUpload,
    })];
  })));
}

function capabilities() {
  return Object.freeze([
    ['telegram', 'Telegram', 'direct'], ['r2', 'R2', 'direct'],
    ['s3', 'S3', 'direct'], ['discord', 'Discord', 'direct'],
    ['huggingface', 'HuggingFace', 'direct'], ['webdav', 'WebDAV', 'mounted'],
    ['github', 'GitHub', 'direct'],
  ].map(([type, label, layer]) => Object.freeze({
    type, label, layer, enableHint: 'Configure this storage backend first.',
  })));
}

function withTimeout(operation) {
  const controller = new AbortController();
  let timeout;
  const deadline = new Promise((resolve) => {
    timeout = setTimeout(() => {
      controller.abort();
      resolve(failed('Connection check timed out'));
    }, PROBE_TIMEOUT_MS);
  });
  return Promise.race([operation(controller.signal), deadline]).finally(() => {
    clearTimeout(timeout);
    controller.abort();
  });
}

async function telegramProbe(env, signal) {
  if (!env.TG_Bot_Token || !env.TG_Chat_ID) return empty();
  const response = await fetch(buildTelegramBotApiUrl(env, 'getMe'), { signal });
  const data = await response.json();
  if (!response.ok || !data?.ok) return failed(data?.description || 'Telegram API check failed');
  return connected(`Connected: @${data.result.username}`, {
    botName: data.result.first_name,
    botUsername: data.result.username,
    apiBase: getTelegramApiBase(env),
  });
}

async function kvProbe(env) {
  if (!env.img_url) return empty();
  const result = await env.img_url.list({ limit: 1 });
  return connected('Connected', { hasData: Boolean(result?.keys?.length) });
}

async function r2Probe(env) {
  if (!env.R2_BUCKET) return empty();
  const result = await env.R2_BUCKET.list({ limit: 1 });
  return connected('Connected', { hasData: Boolean(result?.objects?.length) });
}

async function s3Probe(env) {
  const configured = env.S3_ENDPOINT && env.S3_ACCESS_KEY_ID
    && env.S3_SECRET_ACCESS_KEY && env.S3_BUCKET;
  if (!configured) return empty();
  const ok = await createS3Client(env).checkConnection();
  return ok ? connected(`Connected: ${env.S3_BUCKET}`) : failed('S3 check failed');
}

async function discordProbe(env) {
  if (!env.DISCORD_WEBHOOK_URL && !env.DISCORD_BOT_TOKEN) return empty();
  const result = await checkDiscordConnection(env);
  return result?.connected
    ? connected(`Connected (${result.mode || 'unknown'})`, { mode: result.mode })
    : failed(result?.error || 'Discord check failed');
}

async function huggingFaceProbe(env) {
  if (!hasHuggingFaceConfig(env)) return empty();
  const result = await checkHuggingFaceConnection(env);
  return result?.connected
    ? connected(`Connected: ${result.repoId}`, { isPrivate: result.isPrivate })
    : failed(result?.error || 'HuggingFace check failed');
}

async function webDavProbe(env) {
  if (!hasWebDAVConfig(env)) return empty('mounted');
  const result = await checkWebDAVConnection(env);
  if (!result?.connected) return failed(result?.message || 'WebDAV check failed', 'mounted');
  return Object.freeze({
    ...connected('Connected', { detail: result.detail, status: result.status }),
    layer: 'mounted',
  });
}

async function githubProbe(env) {
  if (!hasGitHubConfig(env)) return empty();
  const result = await checkGitHubConnection(env);
  return result?.connected
    ? connected('Connected', { mode: result.mode, status: result.status })
    : failed(result?.message || 'GitHub check failed');
}

async function safeProbe(operation) {
  try {
    return await withTimeout(operation);
  } catch (error) {
    return failed(error?.message || 'Connection check failed');
  }
}

const STORAGE_PROBES = Object.freeze({
  telegram: telegramProbe,
  r2: r2Probe,
  s3: s3Probe,
  discord: discordProbe,
  huggingface: huggingFaceProbe,
  webdav: webDavProbe,
  github: githubProbe,
});

export async function probeCloudflareStorage({ type, env }) {
  const probe = STORAGE_PROBES[type];
  if (!probe) throw Object.assign(new Error('STORAGE_BACKEND_UNSUPPORTED'), {
    code: 'STORAGE_BACKEND_UNSUPPORTED', status: 400,
  });
  return safeProbe((signal) => probe(env, signal));
}

function profileIdentity(profile) {
  return Object.freeze({
    storageId: profile.id,
    storageName: profile.name,
    storageType: profile.type,
  });
}

function disabledProfileStatus(profile) {
  return Object.freeze({
    ...profileIdentity(profile), connected: false, enabled: false, configured: true,
    layer: profile.type === 'webdav' ? 'mounted' : 'direct',
    message: `Configured (${profile.name}) but disabled`,
  });
}

function profileProbeResult(profile, result) {
  const message = String(result?.message || 'Connection check failed');
  const errorModel = result?.connected
    ? undefined
    : Object.freeze({ code: 'STORAGE_PROBE_FAILED', detail: message });
  return Object.freeze({
    ...result,
    ...profileIdentity(profile),
    connected: Boolean(result?.connected),
    enabled: true,
    configured: true,
    errorModel,
  });
}

async function probeOneProfile(profile, probe) {
  if (!profile.enabled) return disabledProfileStatus(profile);
  try {
    return profileProbeResult(profile, await probe(profile));
  } catch (error) {
    return profileProbeResult(profile, failed(error?.message || 'Connection check failed'));
  }
}

export async function probeCloudflareProfiles({ profiles, probe }) {
  const output = [];
  for (let index = 0; index < profiles.length; index += PROBE_BATCH_SIZE) {
    const batch = profiles.slice(index, index + PROBE_BATCH_SIZE);
    output.push(...await Promise.all(batch.map((profile) => probeOneProfile(profile, probe))));
  }
  return Object.freeze(output);
}

function adapterProbeInput(adapter) {
  if (adapter.type === 'r2' && adapter.mode === 'binding') {
    return Object.freeze({ type: 'r2', env: Object.freeze({ R2_BUCKET: adapter.binding }) });
  }
  if (adapter.type === 'r2') return Object.freeze({ type: 's3', env: adapter.environment });
  return Object.freeze({ type: adapter.type, env: adapter.environment });
}

function probeResolvedProfile(profile, env) {
  return probeCloudflareStorage(adapterProbeInput(createStorageAdapter({ profile, env })));
}

function defaultProfileStatus(type, profiles, statuses) {
  const candidates = profiles.filter((profile) => profile.type === type);
  const selected = candidates.find((profile) => profile.isDefault) || candidates[0];
  if (!selected) return empty(type === 'webdav' ? 'mounted' : 'direct');
  return statuses.find((status) => status.storageId === selected.id)
    || empty(type === 'webdav' ? 'mounted' : 'direct');
}

async function runBatches(entries) {
  const output = {};
  for (let index = 0; index < entries.length; index += PROBE_BATCH_SIZE) {
    const batch = entries.slice(index, index + PROBE_BATCH_SIZE);
    const results = await Promise.all(batch.map(([, operation]) => safeProbe(operation)));
    batch.forEach(([name], resultIndex) => { output[name] = results[resultIndex]; });
  }
  return output;
}

export async function collectCloudflareStatus({ env, repository, profileProbe }) {
  const profileRepository = repository || createStorageProfileRepository(env);
  const snapshot = await profileRepository.runtimeSnapshot();
  const storageProfiles = await probeCloudflareProfiles({
    profiles: snapshot.items,
    probe: profileProbe || ((profile) => probeResolvedProfile(profile, env)),
  });
  const probes = await runBatches([['kv', () => kvProbe(env)]]);
  const typeStatuses = Object.fromEntries(STORAGE_TYPES.map((type) => [
    type, defaultProfileStatus(type, snapshot.items, storageProfiles),
  ]));
  return Object.freeze({
    ...typeStatuses,
    ...probes,
    storageProfiles,
    auth: Object.freeze({ enabled: true, message: 'Enabled' }),
    guestUpload: await getGuestConfig(env),
    uploadLimits: uploadLimits(),
    capabilities: capabilities(),
  });
}
