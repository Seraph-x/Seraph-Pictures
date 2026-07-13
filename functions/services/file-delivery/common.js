const STORAGE_PREFIXES = Object.freeze([
  'img:', 'vid:', 'aud:', 'doc:', 'r2:', 's3:', 'discord:', 'hf:', 'webdav:', 'github:', '',
]);

const MIME_TYPES = Object.freeze({
  mp4: 'video/mp4', webm: 'video/webm', ogg: 'video/ogg', mov: 'video/quicktime',
  avi: 'video/x-msvideo', mkv: 'video/x-matroska', m4v: 'video/x-m4v',
  wmv: 'video/x-ms-wmv', flv: 'video/x-flv', '3gp': 'video/3gpp',
  mp3: 'audio/mpeg', wav: 'audio/wav', flac: 'audio/flac', aac: 'audio/aac',
  m4a: 'audio/mp4', opus: 'audio/opus', wma: 'audio/x-ms-wma', oga: 'audio/ogg',
  jpg: 'image/jpeg', jpeg: 'image/jpeg',
  png: 'image/png', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp',
  svg: 'image/svg+xml', ico: 'image/x-icon', pdf: 'application/pdf',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain', html: 'text/html', css: 'text/css', js: 'text/javascript',
  json: 'application/json', xml: 'application/xml', md: 'text/markdown',
  zip: 'application/zip', rar: 'application/x-rar-compressed',
  '7z': 'application/x-7z-compressed', tar: 'application/x-tar', gz: 'application/gzip',
});

export function inferStorageType(name, metadata = {}) {
  const explicit = metadata.storageType || metadata.storage;
  if (explicit) return String(explicit).toLowerCase();
  const value = String(name || '');
  if (value.startsWith('r2:')) return 'r2';
  if (value.startsWith('s3:')) return 's3';
  if (value.startsWith('discord:')) return 'discord';
  if (value.startsWith('hf:')) return 'huggingface';
  if (value.startsWith('webdav:')) return 'webdav';
  if (value.startsWith('github:')) return 'github';
  return 'telegram';
}

export function getMimeType(fileName = '') {
  const extension = String(fileName).split('.').pop()?.toLowerCase() || '';
  return MIME_TYPES[extension] || 'application/octet-stream';
}

export function addCorsHeaders(headers) {
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Range, Content-Type, Accept, Origin, X-File-Password, X-Share-Password');
  headers.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges, Content-Type, Content-Disposition');
  headers.set('CDN-Cache-Control', 'no-store');
  return headers;
}

export function addResponseHeaders({ headers, fileName, mimeType, upstream = null }) {
  addCorsHeaders(headers);
  headers.set('Content-Type', mimeType || 'application/octet-stream');
  headers.set('Cache-Control', 'no-store, max-age=0');
  headers.set('Accept-Ranges', 'bytes');
  if (fileName) {
    const encoded = encodeURIComponent(fileName);
    headers.set('Content-Disposition', `inline; filename="${encoded}"; filename*=UTF-8''${encoded}`);
  }
  if (upstream?.headers.get('Content-Length')) {
    headers.set('Content-Length', upstream.headers.get('Content-Length'));
  }
  if (upstream?.headers.get('Content-Range')) {
    headers.set('Content-Range', upstream.headers.get('Content-Range'));
  }
}

export function handleOptions() {
  const headers = addCorsHeaders(new Headers());
  headers.set('Access-Control-Max-Age', '86400');
  return new Response(null, { status: 204, headers });
}

export function errorResponse(message, status = 500) {
  const headers = addCorsHeaders(new Headers());
  headers.set('Cache-Control', 'no-store, max-age=0');
  return new Response(message, { status, headers });
}

export function shouldBlock(metadata = {}) {
  const listType = String(metadata.ListType || '').toLowerCase();
  const label = String(metadata.Label || '').toLowerCase();
  return listType === 'block' || label === 'adult';
}

export function shouldWhitelistDeny(env, metadata = {}) {
  return env.WhiteList_Mode === 'true'
    && String(metadata.ListType || '').toLowerCase() !== 'white';
}

export function blockRedirect(requestUrl, request) {
  if (request.headers.get('Referer')) {
    return Response.redirect('https://static-res.pages.dev/teleimage/img-block-compressed.png', 302);
  }
  return Response.redirect(`${requestUrl.origin}/block-img.html`, 302);
}

export async function getRecordWithKey(env, fileId) {
  if (!env.img_url) return Object.freeze({ record: null, kvKey: fileId });
  const prefixed = STORAGE_PREFIXES.some((prefix) => prefix && fileId.startsWith(prefix));
  const keys = prefixed ? [fileId] : STORAGE_PREFIXES.map((prefix) => `${prefix}${fileId}`);
  for (const key of keys) {
    const record = await env.img_url.getWithMetadata(key);
    if (record?.metadata) return Object.freeze({ record, kvKey: key });
  }
  return Object.freeze({ record: null, kvKey: fileId });
}

export async function findRecordByPrefixes(env, fileId, prefixes = []) {
  if (!env.img_url) return null;
  for (const prefix of prefixes) {
    const record = await env.img_url.getWithMetadata(`${prefix}${fileId}`);
    if (record?.metadata) return record;
  }
  return null;
}

function cachedResponse(response, cacheControl, cdnCacheControl) {
  const cached = new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
  cached.headers.set('Cache-Control', cacheControl);
  cached.headers.set('CDN-Cache-Control', cdnCacheControl);
  return cached;
}

export function withBackgroundCache(response) {
  return cachedResponse(response, 'public, max-age=604800, immutable', 'public, max-age=604800');
}

export function withImageCache(response) {
  return cachedResponse(response, 'private, max-age=180', 'no-store');
}

function extractFileId(value) {
  try {
    const pathname = String(value || '').startsWith('http') ? new URL(value).pathname : String(value || '');
    const match = pathname.match(/\/file\/(.+)$/);
    return match ? decodeURIComponent(match[1]) : '';
  } catch {
    return '';
  }
}

export async function isConfiguredBackground(env, fileId) {
  if (!env?.img_url || !fileId) return false;
  try {
    const config = await env.img_url.get('ui_config', { type: 'json' });
    const targets = [config?.globalBackgroundUrl, config?.loginBackgroundUrl]
      .map(extractFileId).filter(Boolean);
    return targets.includes(fileId) || targets.includes(decodeURIComponent(fileId));
  } catch {
    return false;
  }
}
