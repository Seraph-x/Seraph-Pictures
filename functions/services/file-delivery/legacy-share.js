import { errorResponse } from './common.js';

function getSharePassword(request) {
  const url = new URL(request.url);
  return String(
    request.headers.get('X-File-Password')
    || request.headers.get('X-Share-Password')
    || url.searchParams.get('password')
    || '',
  );
}

async function sha256Hex(input) {
  const bytes = new TextEncoder().encode(String(input || ''));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(left, right) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

export async function verifyLegacyShareAccess(context, metadata, kvKey) {
  const expiresAt = Number(metadata.shareExpiresAt || 0);
  if (Number.isFinite(expiresAt) && expiresAt > 0 && Date.now() > expiresAt) {
    return Object.freeze({ response: errorResponse('File link has expired', 410) });
  }
  const maximum = Number(metadata.shareMaxDownloads || 0);
  const current = Number(metadata.shareDownloadCount || 0);
  if (Number.isFinite(maximum) && maximum > 0 && current >= maximum) {
    return Object.freeze({ response: errorResponse('File download limit reached', 410) });
  }
  if (metadata.sharePasswordHash) {
    const password = getSharePassword(context.request);
    if (!password) return Object.freeze({ response: errorResponse('File password required', 401) });
    const actual = await sha256Hex(`${String(metadata.sharePasswordSalt || '')}:${password}`);
    if (!timingSafeEqual(String(metadata.sharePasswordHash), actual)) {
      return Object.freeze({ response: errorResponse('File password invalid', 403) });
    }
  }
  return Object.freeze({
    response: null,
    trackDownload: Number.isFinite(maximum) && maximum > 0,
    kvKey,
    metadata,
  });
}

export function shouldCountAsDownload(method, response) {
  return String(method || '').toUpperCase() === 'GET'
    && (response?.status === 200 || response?.status === 206);
}

export async function incrementLegacyDownloadCount(env, kvKey, metadata) {
  if (!env?.img_url || !kvKey || !metadata) return;
  const fresh = await env.img_url.getWithMetadata(kvKey);
  const latest = fresh?.metadata || metadata;
  await env.img_url.put(kvKey, '', {
    metadata: {
      ...latest,
      shareDownloadCount: Number(latest.shareDownloadCount || 0) + 1,
    },
  });
}
