import {
  assertAllowedRemoteHost, assertPublicRedirect, parseSafeRemoteUrl, RemoteUrlError,
} from '../utils/remote-url.js';
import { formatSize } from './url-upload-common.js';

const MAX_FILE_SIZE = 100 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 30_000;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function allowedHosts(env) {
  return env.URL_UPLOAD_ALLOWED_HOSTS || env.REMOTE_URL_ALLOWED_HOSTS || '';
}

function assertBodySize(size) {
  if (size > MAX_FILE_SIZE) throw new Error(`Remote file exceeds size limit (${formatSize(MAX_FILE_SIZE)}).`);
}

function joinChunks(chunks, totalBytes) {
  const output = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
  return output.buffer;
}

async function readLimitedBody(response) {
  const declared = Number.parseInt(String(response.headers.get('content-length') || ''), 10);
  if (Number.isFinite(declared)) assertBodySize(declared);
  const reader = response.body?.getReader?.();
  if (!reader) {
    const value = await response.arrayBuffer(); assertBodySize(value.byteLength); return value;
  }
  const chunks = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
    totalBytes += chunk.byteLength; assertBodySize(totalBytes); chunks.push(chunk);
  }
  return joinChunks(chunks, totalBytes);
}

function failure(error) {
  if (error instanceof RemoteUrlError || error.status === 400) {
    return { ok: false, status: error.status || 400, error: error.message };
  }
  if (error.name === 'AbortError') return { ok: false, status: 408, error: 'Remote URL request timed out' };
  return { ok: false, status: 502, error: `Cannot fetch remote URL: ${error.message}` };
}

export async function fetchRemote(url, env = {}) {
  const target = parseSafeRemoteUrl(url);
  assertAllowedRemoteHost(target, allowedHosts(env));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(target.toString(), {
      signal: controller.signal, redirect: 'manual',
      headers: { 'User-Agent': 'Mozilla/5.0 Seraph Pictures URL Uploader', Accept: 'image/*,video/*,audio/*,application/*,*/*' },
    });
    if (REDIRECT_STATUSES.has(response.status)) {
      const redirect = assertPublicRedirect(response, target.toString());
      assertAllowedRemoteHost(redirect, allowedHosts(env));
      return { ok: false, status: 400, error: `Remote URL redirects to ${redirect}; follow the final URL explicitly.` };
    }
    if (!response.ok) return { ok: false, status: 502, error: `Remote URL error: ${response.status} ${response.statusText}` };
    return {
      ok: true, contentType: response.headers.get('content-type') || 'application/octet-stream',
      arrayBuffer: await readLimitedBody(response), finalUrl: target,
    };
  } catch (error) {
    return failure(error);
  } finally {
    clearTimeout(timeout);
  }
}
