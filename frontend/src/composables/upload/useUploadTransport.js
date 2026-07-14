function immutablePayload(payload) {
  return Object.freeze(payload);
}

function requiredTarget(target) {
  const storageMode = String(target?.storageMode || '').trim();
  const storageId = String(target?.storageId || '').trim();
  if (!storageMode || !storageId) {
    throw Object.assign(new Error('STORAGE_SELECTION_REQUIRED'), {
      code: 'STORAGE_SELECTION_REQUIRED',
    });
  }
  return immutablePayload({
    storageMode,
    storageId,
    folderPath: String(target?.targetFolderPath || ''),
  });
}

export function buildDirectUploadBody(item) {
  const target = requiredTarget(item.target);
  const body = new FormData();
  body.append('file', item.file);
  body.append('storageMode', target.storageMode);
  body.append('storageId', target.storageId);
  body.append('folderPath', target.folderPath);
  return body;
}

export function buildUrlUploadPayload(options) {
  const target = requiredTarget(options.target);
  return immutablePayload({
    url: String(options.url || ''),
    storageMode: target.storageMode,
    storageId: target.storageId,
    folderPath: target.folderPath,
  });
}

export function buildMultipartInitPayload(options) {
  const { item } = options;
  const target = requiredTarget(item.target);
  return immutablePayload({
    fileName: item.file.name,
    fileSize: item.file.size,
    fileType: item.file.type,
    totalChunks: options.totalChunks,
    rootDigest: options.rootDigest,
    storageMode: target.storageMode,
    storageId: target.storageId,
    folderPath: target.folderPath,
  });
}

function truncate(text, maxLength = 220) {
  const value = String(text || '');
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function parseJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function responseError(payload, statusCode, rawText = '') {
  if (payload && typeof payload === 'object') {
    const nested = payload?.error?.message || payload?.error?.code;
    const message = nested || payload.error || payload.message || payload.errorDetail || payload.detail;
    if (typeof message === 'string' && message.trim()) return message.trim();
  }
  if (rawText) return `Backend returned non-JSON response (${statusCode}): ${truncate(rawText)}`;
  return `Upload failed (${statusCode})`;
}

export function humanizeUploadError(message, t) {
  const text = String(message || '');
  const normalized = text.toLowerCase();
  const rules = [
    [['auth_failed', 'unauthorized', 'forbidden'], 'uv.errAuth'],
    [['rate', 'too many requests', 'flood'], 'uv.errRate'],
    [['quota', 'limit exceeded', 'too large', '413'], 'uv.errQuota'],
    [['network', 'timeout', 'fetch failed'], 'uv.errNetwork'],
    [['not configured'], 'uv.errNotConfigured'],
  ];
  const match = rules.find(([needles]) => needles.some((needle) => normalized.includes(needle)));
  return match ? `${t(match[1])}: ${text}` : text || t('uv.errUploadFailed');
}

function uploadSource(body) {
  if (Array.isArray(body)) return body[0]?.src;
  return body?.src || body?.data?.src || body?.data?.items?.[0]?.src || body?.items?.[0]?.src;
}

function directUpload(options, item) {
  const { apiUrl, t, toAbsoluteUrl } = options;
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', apiUrl('/upload'));
    xhr.withCredentials = true;
    xhr.setRequestHeader('Accept', options.accept);
    xhr.setRequestHeader('X-Seraph-Client', 'app-v2');
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) options.onProgress(item, Math.max(1, Math.floor((event.loaded / event.total) * 100)));
    };
    xhr.onload = () => {
      const rawText = String(xhr.responseText || '');
      const body = parseJson(rawText);
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(humanizeUploadError(responseError(body, xhr.status, rawText), t)));
        return;
      }
      const src = uploadSource(body);
      if (!src) {
        const message = body ? t('uv.errMissingSrc') : `Backend returned non-JSON response: ${truncate(rawText) || '<empty body>'}`;
        reject(new Error(message));
        return;
      }
      resolve(toAbsoluteUrl(src));
    };
    xhr.onerror = () => reject(new Error(t('uv.errNetworkShort')));
    xhr.send(buildDirectUploadBody(item));
  });
}

async function chunkUpload(options, item) {
  const totalChunks = Math.ceil(item.file.size / options.chunkSize);
  const digests = await options.createDigestPlan(item.file, options.chunkSize);
  const init = await options.apiFetch('/api/chunked-upload/init', {
    method: 'POST', headers: options.jsonHeaders,
    body: JSON.stringify(buildMultipartInitPayload({ item, totalChunks, rootDigest: digests.rootDigest })),
  });
  options.onMultipartStart(item, init.uploadId);
  const chunkSize = Number(init.chunkSize || options.chunkSize);
  for (let index = 0; index < totalChunks; index += 1) {
    const chunk = item.file.slice(index * chunkSize, Math.min(item.file.size, (index + 1) * chunkSize));
    const body = new FormData();
    body.append('uploadId', init.uploadId);
    body.append('chunkIndex', String(index));
    body.append('digest', digests.partDigests[index]);
    body.append('chunk', chunk);
    await options.apiFetch('/api/chunked-upload/chunk', {
      method: 'POST', headers: options.uploadHeaders, body,
    });
    options.onProgress(item, Math.min(95, Math.floor(((index + 1) / totalChunks) * 95)));
  }
  const done = await options.apiFetch('/api/chunked-upload/complete', {
    method: 'POST', headers: options.jsonHeaders,
    body: JSON.stringify({ uploadId: init.uploadId }),
  });
  if (!done?.src) throw new Error(options.t('uv.errMissingSrc'));
  options.onMultipartFinish(item);
  return options.toAbsoluteUrl(done.src);
}

export function useUploadTransport(options) {
  return Object.freeze({
    directUpload: (item) => directUpload(options, item),
    chunkUpload: (item) => chunkUpload(options, item),
    uploadUrl: async ({ url, target }) => {
      const body = await options.apiFetch('/api/upload-from-url', {
        method: 'POST', headers: options.jsonHeaders,
        body: JSON.stringify(buildUrlUploadPayload({ url, target })),
      });
      const src = uploadSource(body);
      if (!src) throw new Error(options.t('uv.errMissingSrc'));
      return options.toAbsoluteUrl(src);
    },
  });
}
