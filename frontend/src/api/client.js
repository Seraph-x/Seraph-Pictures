const API_BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/+$/, '');
const V2_ACCEPT = 'application/vnd.seraph.v2+json, application/json;q=0.9, text/plain;q=0.5, */*;q=0.1';

function buildUrl(path) {
  return `${API_BASE}${path}`;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function truncate(value, maxLength = 240) {
  const text = String(value || '');
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function resolveErrorMessage(payload, fallback) {
  if (typeof payload === 'string' && payload.trim()) return payload.trim();
  if (!isPlainObject(payload)) return fallback;

  if (typeof payload.error === 'string' && payload.error.trim()) return payload.error.trim();
  if (isPlainObject(payload.error) && typeof payload.error.code === 'string' && payload.error.code.trim()) {
    return payload.error.code.trim();
  }
  if (isPlainObject(payload.error) && typeof payload.error.message === 'string' && payload.error.message.trim()) {
    return payload.error.message.trim();
  }
  if (typeof payload.message === 'string' && payload.message.trim()) return payload.message.trim();
  if (typeof payload.errorDetail === 'string' && payload.errorDetail.trim()) return payload.errorDetail.trim();
  return fallback;
}

export async function apiFetch(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (!headers.has('Accept')) headers.set('Accept', V2_ACCEPT);
  if (!headers.has('X-Seraph-Client')) headers.set('X-Seraph-Client', 'app-v2');

  const response = await fetch(buildUrl(path), {
    credentials: 'include',
    ...options,
    headers,
  });

  const text = await response.text();
  let parsed = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }

  const isJson = parsed != null;
  const payload = isJson ? parsed : text;

  if (!response.ok) {
    const fallback = `Request failed: ${response.status}`;
    const snippet = text ? ` | response: ${truncate(text)}` : ' | response: <empty>';
    const message = isJson
      ? resolveErrorMessage(payload, fallback)
      : `Backend returned non-JSON response (${response.status})${snippet}`;

    const error = new Error(message);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  if (isPlainObject(payload) && typeof payload.success === 'boolean') {
    if (!payload.success) {
      const message = resolveErrorMessage(payload, 'Request failed.');
      const error = new Error(message);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'data')) {
      return payload.data;
    }
    return payload;
  }

  return payload;
}

export function getApiBase() {
  return API_BASE;
}

export function fileUrl(id) {
  return `${API_BASE}/file/${encodeURIComponent(id)}`;
}

export function absoluteFileUrl(id) {
  return new URL(fileUrl(id), window.location.origin).toString();
}
