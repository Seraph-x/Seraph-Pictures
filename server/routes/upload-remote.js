const { normalizeFolderPath } = require('../lib/repos/file-repo');
const { GUEST_LIMITS } = require('../../shared/security/guest-policy.cjs');
const {
  normalizeDockerUploadSelection,
  normalizeDockerUploadAccess,
  readUploadOperationId,
} = require('../lib/services/upload-request');

function remoteLimit(container, authenticated) {
  const configured = Math.min(
    container.config.uploadSmallFileThreshold,
    container.config.uploadMaxSize,
  );
  if (authenticated) return configured;
  const guestMaximum = container.config.guestMaxFileSize > 0
    ? container.config.guestMaxFileSize
    : GUEST_LIMITS.maximumFileBytes;
  return Math.min(configured, guestMaximum, GUEST_LIMITS.maximumFileBytes);
}

async function reserveGuest({ auth, services, request, prepared }) {
  if (auth.authenticated) return null;
  return services.guestService.reserveUpload({
    request,
    descriptor: Object.freeze({
      fileName: prepared.fileName,
      mimeType: prepared.mimeType,
      declaredBytes: prepared.fileSize,
      buffer: new Uint8Array(prepared.buffer),
    }),
  });
}

async function uploadPrepared(options) {
  const { payload, auth, prepared, reservation, services, request } = options;
  let result;
  try {
    const selection = normalizeDockerUploadSelection({
      authenticated: auth.authenticated,
      storageMode: reservation ? 'telegram' : payload.storageMode || payload.storage,
      storageId: reservation?.storageId || payload.storageId || payload.storage_config_id,
    });
    const access = normalizeDockerUploadAccess({
      authenticated: auth.authenticated, uploadSource: payload.uploadSource,
    });
    result = await services.uploadService.uploadFile({
      ...prepared,
      ...selection,
      operationId: readUploadOperationId(request),
      folderPath: normalizeFolderPath(payload.folderPath || payload.folder || ''),
      ...access,
      expiresAt: reservation?.fileExpiresAt,
      retentionDays: reservation?.retentionDays,
    });
  } catch (error) {
    if (reservation) await services.guestService.cancelUpload(reservation.reservationId);
    throw error;
  }
  if (reservation) await services.guestService.completeUpload(reservation.reservationId);
  return result;
}

async function executeRemoteUpload({ context, container, payload, auth, services }) {
  const prepared = await services.uploadService.prepareRemoteFile({
    url: payload.url,
    maxBytes: remoteLimit(container, auth.authenticated),
  });
  const reservation = await reserveGuest({
    auth, services, request: context.req.raw, prepared,
  });
  return uploadPrepared({
    payload, auth, prepared, reservation, services, request: context.req.raw,
  });
}

async function handleRemoteUpload(context, container, helpers) {
  const services = helpers.getServices(context);
  const auth = services.authService.checkAuthentication(context.req.raw);
  const payload = await context.req.json().catch(() => ({}));
  if (!payload.url) {
    return helpers.jsonError(context, 400, 'URL_REQUIRED', 'url is required.', 'Missing url.');
  }
  try {
    const result = await executeRemoteUpload({ context, container, payload, auth, services });
    return helpers.uploadSuccessResponse(context, result);
  } catch (error) {
    const status = error?.status || 502;
    const normalized = helpers.normalizeUploadError(context, error, status);
    return context.json({ ...normalized, traceId: helpers.getTraceId(context) }, status);
  }
}

function registerRemoteUploadRoute(app, container, helpers) {
  app.post('/api/upload-from-url', (context) => handleRemoteUpload(context, container, helpers));
}

module.exports = { registerRemoteUploadRoute };
