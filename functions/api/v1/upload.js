import { onRequestPost as uploadInternal } from '../../upload.js';
import { apiError, apiSuccess, buildAbsoluteUrl } from '../../utils/api-v1.js';
import fileMetadataPolicy from '../../../shared/security/file-metadata.cjs';
import sharePolicy from '../../../shared/security/share-policy.cjs';
import { createCloudflareShare } from '../../services/share-access.js';
import {
  applyApiUploadMetadata,
  extractUploadResultId,
  findRecordByFileId,
  mapMimeType,
  normalizeStorageType,
  resolveUploadErrorStatus,
  sanitizeSlug,
} from '../../services/api-upload-metadata.js';

const { createAccessMetadata } = fileMetadataPolicy;
const { normalizeShareRequest } = sharePolicy;

export function readOptions(formData, url) {
  const read = (formName, queryName = formName) => String(
    formData.get(formName) || url.searchParams.get(queryName) || '',
  );
  return Object.freeze({
    storage: read('storage').trim().toLowerCase(),
    storageId: read('storageId', 'storage_id').trim()
      || read('storage_id', 'storageId').trim(),
    password: read('password'),
    expiresIn: read('expires_in'),
    maxDownloads: read('max_downloads'),
    slug: read('slug'),
    visibility: read('visibility') || 'public',
  });
}

function validateOptions(options) {
  try {
    createAccessMetadata({ uploadSource: 'api', requestedVisibility: options.visibility });
  } catch (error) {
    return apiError(error.code, '字段 "visibility" 必须是 public 或 private。', 400);
  }
  if (options.slug && !sanitizeSlug(options.slug)) {
    return apiError('VALIDATION_ERROR', '字段 "slug" 只能包含字母、数字、下划线或短横线。', 400);
  }
  if (options.visibility === 'private') {
    try {
      normalizeShareRequest({
        fileId: 'validation',
        accessVersion: 1,
        ttlSeconds: options.expiresIn ? Number(options.expiresIn) : undefined,
        maxDownloads: options.maxDownloads ? Number(options.maxDownloads) : null,
        nowMs: 0,
      });
    } catch (error) {
      return apiError(error.code, '私有分享的有效期或下载次数无效。', 400);
    }
  }
  return null;
}

export function buildUploadRequest(request, formData, options) {
  const uploadForm = new FormData();
  for (const [key, value] of formData.entries()) {
    if (!['storage', 'storage_id', 'storageId'].includes(key)) uploadForm.append(key, value);
  }
  if (options.storage) uploadForm.set('storageMode', options.storage);
  if (options.storageId) uploadForm.set('storageId', options.storageId);
  const headers = new Headers(request.headers);
  ['content-type', 'content-length'].forEach((name) => headers.delete(name));
  return new Request(request.url, { method: 'POST', headers, body: uploadForm });
}

async function readPayload(response) {
  try {
    return await response.clone().json();
  } catch {
    return null;
  }
}

function uploadFailure(response, payload) {
  const message = payload?.error || payload?.message || '上传失败。';
  const status = resolveUploadErrorStatus(response.status || 500, message);
  return apiError(status === 413 ? 'FILE_TOO_LARGE' : 'UPLOAD_FAILED', message, status);
}

async function updateMetadata(env, publicId, options) {
  const lookup = await findRecordByFileId(env, publicId);
  if (!lookup?.key) return Object.freeze({ lookup, metadata: {} });
  const metadata = await applyApiUploadMetadata({
    env,
    key: lookup.key,
    originalMetadata: lookup.record?.metadata || {},
    options: { ...options, slug: sanitizeSlug(options.slug) },
  });
  const privateShare = options.visibility === 'private'
    ? await createCloudflareShare({
        env,
        fileId: lookup.key,
        accessVersion: metadata.accessVersion,
        ttlSeconds: options.expiresIn ? Number(options.expiresIn) : undefined,
        password: options.password,
        maxDownloads: options.maxDownloads ? Number(options.maxDownloads) : null,
      })
    : null;
  return Object.freeze({ lookup, metadata, privateShare });
}

function successResponse(options) {
  const {
    request, file, publicId, lookup, metadata, privateShare, options: requestOptions,
  } = options;
  const canonicalId = lookup?.key || publicId;
  const fileName = metadata.fileName || file.name || canonicalId;
  const legacyShareId = sanitizeSlug(metadata.shareSlug || '')
    || sanitizeSlug(requestOptions.slug) || publicId;
  const sharePath = privateShare?.sharePath || `/s/${encodeURIComponent(legacyShareId)}`;
  return apiSuccess({
    file: {
      id: canonicalId,
      name: fileName,
      size: Number(metadata.fileSize || file.size || 0),
      type: mapMimeType(fileName, file.type || 'application/octet-stream'),
      storage: normalizeStorageType(canonicalId, metadata),
      uploadedAt: new Date(Number(metadata.TimeStamp || Date.now())).toISOString(),
    },
    links: {
      download: buildAbsoluteUrl(request, `/file/${encodeURIComponent(publicId)}`),
      share: buildAbsoluteUrl(request, sharePath),
      delete: buildAbsoluteUrl(request, `/api/v1/file/${encodeURIComponent(canonicalId)}`),
    },
  });
}

export async function onRequestPost(context) {
  let formData;
  try {
    formData = await context.request.formData();
  } catch {
    return apiError('BAD_REQUEST', '请求必须使用 multipart/form-data 格式。', 400);
  }
  const file = formData.get('file');
  if (!file) return apiError('VALIDATION_ERROR', '缺少必填字段 "file"。', 400);
  const options = readOptions(formData, new URL(context.request.url));
  const invalid = validateOptions(options);
  if (invalid) return invalid;
  context.data = context.data || {};
  context.data.fileVisibility = options.visibility;
  const response = await uploadInternal({
    ...context,
    request: buildUploadRequest(context.request, formData, options),
  });
  const payload = await readPayload(response);
  if (!response.ok) return uploadFailure(response, payload);
  const publicId = extractUploadResultId(payload);
  if (!publicId) return apiError('UPLOAD_FAILED', '上传响应中缺少文件标识。', 502);
  try {
    const result = await updateMetadata(context.env, publicId, options);
    return successResponse({ request: context.request, file, publicId, ...result, options });
  } catch (error) {
    const conflict = String(error?.message || '').includes('已被占用');
    return apiError(conflict ? 'SLUG_CONFLICT' : 'UPLOAD_METADATA_FAILED', error.message, conflict ? 409 : 500);
  }
}

export async function onRequest(context) {
  return context.request.method === 'POST'
    ? onRequestPost(context)
    : apiError('METHOD_NOT_ALLOWED', '请求方法不被允许。', 405);
}
