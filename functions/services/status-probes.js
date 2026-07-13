import { createS3Client } from '../utils/s3client.js';
import { checkDiscordConnection } from '../utils/discord.js';
import { checkHuggingFaceConnection, hasHuggingFaceConfig } from '../utils/huggingface.js';
import { checkWebDAVConnection, hasWebDAVConfig } from '../utils/webdav.js';
import { checkGitHubConnection, hasGitHubConfig } from '../utils/github.js';
import { getGuestConfig } from '../utils/guest.js';
import { buildTelegramBotApiUrl, getTelegramApiBase } from '../utils/telegram.js';
import { resolveStorageEnv } from '../utils/storage-config.js';

const MEBIBYTE = 1024 * 1024;
const DIRECT_LIMIT = 20 * MEBIBYTE;
const LARGE_LIMIT = 100 * MEBIBYTE;
const PROBE_TIMEOUT_MS = 5_000;
const PROBE_BATCH_SIZE = 3;

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
  const large = Object.freeze({
    maxBytes: LARGE_LIMIT, directThreshold: DIRECT_LIMIT, supportsChunkUpload: true,
  });
  return Object.freeze({
    telegram: Object.freeze({
      maxBytes: DIRECT_LIMIT, directThreshold: DIRECT_LIMIT, supportsChunkUpload: false,
      message: 'Telegram web upload on Cloudflare Pages is limited to 20MB.',
    }),
    r2: large,
    s3: large,
    discord: Object.freeze({ ...large, maxBytes: 25 * MEBIBYTE }),
    huggingface: Object.freeze({ ...large, maxBytes: 35 * MEBIBYTE }),
    webdav: large,
    github: large,
  });
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

async function runBatches(entries) {
  const output = {};
  for (let index = 0; index < entries.length; index += PROBE_BATCH_SIZE) {
    const batch = entries.slice(index, index + PROBE_BATCH_SIZE);
    const results = await Promise.all(batch.map(([, operation]) => safeProbe(operation)));
    batch.forEach(([name], resultIndex) => { output[name] = results[resultIndex]; });
  }
  return output;
}

export async function collectCloudflareStatus({ env }) {
  const resolved = await resolveStorageEnv(env);
  const probes = await runBatches([
    ['telegram', (signal) => telegramProbe(resolved, signal)], ['kv', () => kvProbe(resolved)],
    ['r2', () => r2Probe(resolved)], ['s3', () => s3Probe(resolved)],
    ['discord', () => discordProbe(resolved)],
    ['huggingface', () => huggingFaceProbe(resolved)],
    ['webdav', () => webDavProbe(resolved)], ['github', () => githubProbe(resolved)],
  ]);
  return Object.freeze({
    ...probes,
    auth: Object.freeze({ enabled: true, message: 'Enabled' }),
    guestUpload: await getGuestConfig(resolved),
    uploadLimits: uploadLimits(),
    capabilities: capabilities(),
  });
}
