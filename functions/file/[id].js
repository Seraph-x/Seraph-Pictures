import { parseSignedTelegramFileId } from '../utils/telegram.js';
import { createAuthErrorResponse } from '../utils/auth/http-errors.js';
import {
  authorizeFileRequest,
  fileAccessErrorResponse,
  readVisibilityMigrationState,
} from '../services/file-access.js';
import { deliverFile } from '../services/file-delivery.js';
import {
  errorResponse,
  getRecordWithKey,
  handleOptions,
  isConfiguredBackground,
  withBackgroundCache,
  withImageCache,
} from '../services/file-delivery/common.js';
import {
  incrementLegacyDownloadCount,
  shouldCountAsDownload,
  verifyLegacyShareAccess,
} from '../services/file-delivery/legacy-share.js';
import {
  ensureSignedTelegramRecord,
  handleSignedTelegramFile,
} from '../services/file-delivery/telegram.js';

async function applyResponseCache(env, fileId, response) {
  if (response?.status !== 200) return response;
  const contentType = response.headers.get('Content-Type') || '';
  if (!contentType.startsWith('image/')) return response;
  return await isConfiguredBackground(env, fileId)
    ? withBackgroundCache(response)
    : withImageCache(response);
}

function scheduleLegacyCount(context, access, response) {
  if (!access?.trackDownload) return;
  if (!shouldCountAsDownload(context.request.method, response)) return;
  const operation = incrementLegacyDownloadCount(
    context.env,
    access.kvKey,
    access.metadata,
  );
  if (typeof context.waitUntil === 'function') {
    context.waitUntil(operation);
  } else {
    operation.catch((error) => console.error('Share count update failed:', error));
  }
}

async function handleFileRequest(context) {
  const fileId = context.params.id;
  if (!fileId) return errorResponse('Missing file id', 400);
  const signed = await parseSignedTelegramFileId(fileId, context.env);
  if (signed) {
    const migration = await readVisibilityMigrationState(context.env);
    const found = await ensureSignedTelegramRecord({
      env: context.env,
      signed,
      migrationComplete: migration.complete,
    });
    if (!found.record?.metadata) return errorResponse('File not found', 404);
    const access = await authorizeFileRequest({
      context,
      metadata: found.record?.metadata || {},
      migrationComplete: migration.complete,
    });
    return access.allowed
      ? handleSignedTelegramFile(context, signed)
      : errorResponse('File not found', 404);
  }
  const found = await getRecordWithKey(context.env, fileId);
  if (context.env.img_url && !found.record?.metadata) {
    return errorResponse('File not found', 404);
  }
  const access = await authorizeFileRequest({
    context,
    metadata: found.record?.metadata || {},
  });
  if (!access.allowed) return errorResponse('File not found', 404);
  const legacyShare = await verifyLegacyShareAccess(
    context,
    found.record?.metadata || {},
    found.kvKey,
  );
  if (legacyShare.response) return legacyShare.response;
  const response = await deliverFile({ context, fileId, record: found.record });
  scheduleLegacyCount(context, legacyShare, response);
  return applyResponseCache(context.env, fileId, response);
}

function boundaryError(error) {
  const auth = createAuthErrorResponse(error);
  if (auth) return auth;
  if (String(error?.code || '').startsWith('FILE_VISIBILITY_')) {
    return fileAccessErrorResponse(error);
  }
  if (error?.code === 'STORAGE_CONFIG_UNAVAILABLE') {
    return Response.json({ error: { code: error.code } }, { status: 503 });
  }
  console.error('file route error:', error);
  return errorResponse(`File proxy error: ${error?.message || 'Unknown error'}`, 502);
}

export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') return handleOptions();
  try {
    return await handleFileRequest(context);
  } catch (error) {
    return boundaryError(error);
  }
}
