import { checkAuthentication, isAuthRequired } from '../../utils/auth.js';
import { createAuthErrorResponse } from '../../utils/auth/http-errors.js';
import { createCloudflareShare } from '../../services/share-access.js';
import {
  readVisibilityMigrationState,
  resolveFileAccessMetadata,
} from '../../services/file-access.js';
import { getRecordWithKey } from '../../services/file-delivery/common.js';

function jsonError(code, status) {
  return Response.json({ success: false, error: { code } }, { status });
}

async function requireAdministrator(context) {
  if (!isAuthRequired(context.env)) return null;
  const auth = await checkAuthentication(context);
  return auth.authenticated ? null : jsonError('AUTH_REQUIRED', 401);
}

function readOptionalInteger(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : Number.NaN;
}

function shareErrorStatus(code) {
  if (code === 'SHARE_ID_CONFLICT') return 409;
  const validation = new Set([
    'SHARE_FILE_INVALID',
    'SHARE_ACCESS_VERSION_INVALID',
    'SHARE_TTL_INVALID',
    'SHARE_DOWNLOAD_LIMIT_INVALID',
  ]);
  return validation.has(code) ? 400 : 503;
}

function publicShareResponse(context, fileId) {
  const sharePath = `/file/${encodeURIComponent(fileId)}`;
  return Response.json({
    success: true,
    permission: 'public-read',
    expiresAt: null,
    sharePath,
    shareUrl: new URL(sharePath, context.request.url).toString(),
  });
}

export async function onRequestPost(context) {
  try {
    const unauthorized = await requireAdministrator(context);
    if (unauthorized) return unauthorized;
    const body = await context.request.json();
    const fileId = String(body.fileId || body.id || '').trim();
    if (!fileId) return jsonError('SHARE_FILE_INVALID', 400);
    const found = await getRecordWithKey(context.env, fileId);
    if (!found.record?.metadata) return jsonError('FILE_ACCESS_DENIED', 404);
    const migration = await readVisibilityMigrationState(context.env);
    const access = await resolveFileAccessMetadata({
      env: context.env,
      metadata: found.record.metadata,
      migrationComplete: migration.complete,
    });
    if (access.visibility === 'public') {
      return publicShareResponse(context, found.kvKey);
    }
    const share = await createCloudflareShare({
      env: context.env,
      fileId: found.kvKey,
      accessVersion: access.accessVersion,
      ttlSeconds: readOptionalInteger(body.ttlSeconds ?? body.expiresIn),
      password: String(body.password || ''),
      maxDownloads: readOptionalInteger(body.maxDownloads) ?? null,
    });
    return Response.json({
      success: true,
      permission: 'private-read-signed',
      expiresAt: share.expiresAt,
      shareId: share.shareId,
      sharePath: share.sharePath,
      shareUrl: new URL(share.sharePath, context.request.url).toString(),
    });
  } catch (error) {
    const authError = createAuthErrorResponse(error);
    if (authError) return authError;
    const code = error?.code || 'SHARE_STATE_UNAVAILABLE';
    return jsonError(code, shareErrorStatus(code));
  }
}

export async function onRequest(context) {
  return context.request.method === 'POST'
    ? onRequestPost(context)
    : jsonError('METHOD_NOT_ALLOWED', 405);
}
