import { parseSignedTelegramFileId } from '../utils/telegram.js';
import { parsePositiveInt } from '../utils/api-v1.js';
import fileMetadataPolicy from '../../shared/security/file-metadata.cjs';

const PREFIXES = Object.freeze([
  'r2:', 's3:', 'discord:', 'hf:', 'webdav:', 'github:', 'img:', 'vid:', 'aud:', 'doc:', '',
]);
const SLUG_PREFIX = 'share_slug:';
const MAX_SLUG_LENGTH = 64;
const PASSWORD_SALT_LENGTH = 12;
const MAX_SHARE_DAYS = 3650;
const SECONDS_PER_DAY = 24 * 60 * 60;
const MAX_SHARE_DOWNLOADS = 1_000_000_000;
const { createAccessMetadata } = fileMetadataPolicy;

export function normalizeStorageType(name = '', metadata = {}) {
  const explicit = metadata.storageType || metadata.storage;
  if (explicit) return String(explicit).toLowerCase();
  const prefix = String(name || '').split(':')[0];
  const aliases = {
    hf: 'huggingface', img: 'telegram', vid: 'telegram', aud: 'telegram', doc: 'telegram',
  };
  return PREFIXES.includes(`${prefix}:`) ? (aliases[prefix] || prefix) : 'telegram';
}

function randomString(length) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return [...bytes].map((byte) => chars[byte % chars.length]).join('');
}

async function sha256Hex(input) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(String(input || '')),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function candidateIds(rawId, signed) {
  const candidates = new Set([rawId]);
  if (signed) {
    candidates.add(`${signed.fileId}.${signed.fileExtension || 'bin'}`);
    candidates.add(signed.fileId);
  } else if (!PREFIXES.some((prefix) => prefix && rawId.startsWith(prefix))) {
    PREFIXES.forEach((prefix) => candidates.add(`${prefix}${rawId}`));
  }
  return [...candidates].filter(Boolean);
}

export async function findRecordByFileId(env, fileId) {
  if (!env?.img_url) return null;
  const rawId = String(fileId || '').trim();
  const signed = await parseSignedTelegramFileId(rawId, env);
  for (const key of candidateIds(rawId, signed)) {
    const record = await env.img_url.getWithMetadata(key);
    if (record?.metadata) return Object.freeze({ key, record });
  }
  return null;
}

export function sanitizeSlug(value = '') {
  return String(value).trim().toLowerCase()
    .replace(/[^a-z0-9_-]/g, '').slice(0, MAX_SLUG_LENGTH);
}

function applyLimits(metadata, options) {
  const expiresIn = parsePositiveInt(options.expiresIn, {
    defaultValue: 0, min: 1, max: MAX_SHARE_DAYS * SECONDS_PER_DAY,
  });
  const maximum = parsePositiveInt(options.maxDownloads, {
    defaultValue: 0, min: 1, max: MAX_SHARE_DOWNLOADS,
  });
  const expiration = expiresIn > 0
    ? { shareExpiresAt: Date.now() + expiresIn * 1000 }
    : {};
  const downloads = maximum > 0
    ? { shareMaxDownloads: maximum, shareDownloadCount: Number(metadata.shareDownloadCount || 0) }
    : {};
  return Object.freeze({ ...metadata, ...expiration, ...downloads });
}

async function applyPassword(metadata, password) {
  if (!password) return metadata;
  const salt = randomString(PASSWORD_SALT_LENGTH);
  return Object.freeze({
    ...metadata,
    sharePasswordSalt: salt,
    sharePasswordHash: await sha256Hex(`${salt}:${password}`),
  });
}

async function assertSlugAvailable({ env, key, slug }) {
  if (!slug) return;
  const existing = await env.img_url.get(`${SLUG_PREFIX}${slug}`);
  if (existing && String(existing) !== String(key)) throw new Error('自定义短链标识已被占用。');
}

async function updateSlug({ env, key, oldSlug, slug }) {
  if (!slug) return;
  if (oldSlug && oldSlug !== slug) await env.img_url.delete(`${SLUG_PREFIX}${oldSlug}`);
  await env.img_url.put(`${SLUG_PREFIX}${slug}`, key, {
    metadata: { fileId: key, updatedAt: Date.now() },
  });
}

export async function applyApiUploadMetadata({ env, key, originalMetadata, options }) {
  if (!env?.img_url || !key) return originalMetadata || {};
  const accessMetadata = {
    ...(originalMetadata || {}),
    ...createAccessMetadata({ uploadSource: 'api', requestedVisibility: options.visibility }),
  };
  const limitedMetadata = applyLimits(accessMetadata, options);
  const protectedMetadata = await applyPassword(limitedMetadata, String(options.password || ''));
  const slug = sanitizeSlug(options.slug);
  const metadata = Object.freeze({
    ...protectedMetadata,
    ...(slug ? { shareSlug: slug } : {}),
  });
  await assertSlugAvailable({ env, key, slug });
  await env.img_url.put(key, '', { metadata });
  await updateSlug({
    env,
    key,
    oldSlug: sanitizeSlug(originalMetadata?.shareSlug || ''),
    slug,
  });
  return metadata;
}

export function extractUploadResultId(payload) {
  const source = Array.isArray(payload) ? payload[0]?.src : payload?.src;
  return source ? String(source).replace(/^\/file\//, '') : '';
}

export function mapMimeType(fileName = '', fallback = 'application/octet-stream') {
  const extension = String(fileName).split('.').pop()?.toLowerCase();
  const types = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    webp: 'image/webp', svg: 'image/svg+xml', mp4: 'video/mp4', webm: 'video/webm',
    mov: 'video/quicktime', mp3: 'audio/mpeg', wav: 'audio/wav', flac: 'audio/flac',
    txt: 'text/plain', json: 'application/json', pdf: 'application/pdf',
  };
  return types[extension] || fallback;
}

export function resolveUploadErrorStatus(status, message) {
  if (status === 413) return 413;
  const text = String(message || '').toLowerCase();
  if (['size limit', 'too large', 'limit exceeded'].some((value) => text.includes(value))) return 413;
  return status >= 400 && status < 600 ? status : 500;
}
