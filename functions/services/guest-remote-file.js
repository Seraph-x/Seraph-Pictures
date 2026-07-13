import {
  assertAllowedRemoteHost,
  assertPublicRedirect,
  parseSafeRemoteUrl,
} from '../utils/remote-url.js';

const FETCH_TIMEOUT_MS = 30_000;

function remoteName(url, mimeType) {
  const candidate = decodeURIComponent(url.pathname.split('/').pop() || '').trim();
  const extensions = {
    'image/avif': 'avif',
    'image/gif': 'gif',
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
  };
  if (candidate) return candidate;
  return `remote-${Date.now()}.${extensions[mimeType] || 'bin'}`;
}

async function readLimitedBody(response, maximumBytes) {
  const declared = Number.parseInt(response.headers.get('content-length') || '0', 10);
  if (declared > maximumBytes) throw Object.assign(new Error('GUEST_FILE_TOO_LARGE'), { status: 413 });
  const reader = response.body?.getReader?.();
  if (!reader) throw Object.assign(new Error('GUEST_REMOTE_BODY_UNREADABLE'), { status: 502 });
  const chunks = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
    totalBytes += chunk.byteLength;
    if (totalBytes > maximumBytes) {
      await reader.cancel('GUEST_FILE_TOO_LARGE');
      throw Object.assign(new Error('GUEST_FILE_TOO_LARGE'), { status: 413 });
    }
    chunks.push(chunk);
  }
  if (!totalBytes) throw Object.assign(new Error('GUEST_FILE_EMPTY'), { status: 400 });
  const output = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output.buffer;
}

async function fetchRemote(url, env, maximumBytes) {
  const allowlist = env.URL_UPLOAD_ALLOWED_HOSTS || env.REMOTE_URL_ALLOWED_HOSTS || '';
  assertAllowedRemoteHost(url, allowlist);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url.toString(), {
      signal: controller.signal,
      redirect: 'manual',
      headers: { Accept: 'image/*', 'User-Agent': 'Seraph-Pictures-Guest/1.0' },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const redirect = assertPublicRedirect(response, url.toString());
      if (redirect) assertAllowedRemoteHost(redirect, allowlist);
      throw Object.assign(new Error('GUEST_REMOTE_REDIRECT_REJECTED'), { status: 400 });
    }
    if (!response.ok) throw Object.assign(new Error('GUEST_REMOTE_FETCH_FAILED'), { status: 502 });
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

export async function prepareRemoteGuestFile(request, env, maximumBytes) {
  const body = await request.clone().json().catch(() => ({}));
  const url = parseSafeRemoteUrl(body.url);
  const response = await fetchRemote(url, env, maximumBytes);
  const mimeType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const buffer = await readLimitedBody(response, maximumBytes);
  return Object.freeze({
    fileName: remoteName(url, mimeType),
    mimeType,
    declaredBytes: buffer.byteLength,
    buffer,
    folderPath: String(body.folderPath || body.folder || ''),
  });
}
