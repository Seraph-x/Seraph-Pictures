const { normalizeFolderPath } = require('../lib/repos/file-repo');
const {
  normalizeDockerUploadSelection,
  normalizeDockerUploadAccess,
  readUploadOperationId,
} = require('../lib/services/upload-request');

function validateMaximum({ context, fileSize, limit, helpers }) {
  if (fileSize <= limit) return null;
  return helpers.jsonError(
    context,
    413,
    'FILE_TOO_LARGE',
    'File exceeds upload size limit.',
    `Upload limit is ${Math.floor(limit / 1024 / 1024)}MB.`,
  );
}

function validateStorageLimit(options) {
  const { context, fileSize, storageMode, container, helpers, audience } = options;
  const selected = storageMode || container.config.bootstrapDefaultStorage?.type || 'telegram';
  const type = audience === 'guest' ? 'telegram' : selected;
  try {
    helpers.validateUploadCapability({ type, mode: 'direct', fileSize, audience });
    return null;
  } catch (error) {
    return helpers.jsonError(
      context, error.status || 400, error.code,
      'Selected storage cannot accept this upload.', error.message,
    );
  }
}

async function performUpload(options) {
  const { context, body, file, buffer, auth, reservation, uploadService, helpers } = options;
  try {
    const selection = normalizeDockerUploadSelection({
      authenticated: auth.authenticated,
      storageMode: reservation ? 'telegram' : helpers.asString(body.storageMode || body.storage),
      storageId: reservation?.storageId
        || helpers.asString(body.storageId || body.storage_config_id),
    });
    const access = normalizeDockerUploadAccess({
      authenticated: auth.authenticated, uploadSource: body.uploadSource,
    });
    return await uploadService.uploadFile({
      fileName: file.name,
      mimeType: file.type,
      fileSize: buffer.byteLength,
      buffer,
      ...selection,
      operationId: readUploadOperationId(context.req.raw),
      folderPath: normalizeFolderPath(body.folderPath || body.folder || ''),
      ...access,
      expiresAt: reservation?.fileExpiresAt,
      retentionDays: reservation?.retentionDays,
    });
  } catch (error) {
    const status = error?.status || 502;
    const normalized = helpers.normalizeUploadError(context, error, status);
    return context.json({ ...normalized, traceId: helpers.getTraceId(context) }, status);
  }
}

async function reserveGuestUpload({ auth, services, request, file, buffer }) {
  if (auth.authenticated) return null;
  return services.guestService.reserveUpload({
    request,
    descriptor: Object.freeze({
      fileName: file.name,
      mimeType: file.type,
      declaredBytes: file.size,
      buffer: new Uint8Array(buffer),
    }),
  });
}

async function settleGuestUpload({ services, reservation, succeeded }) {
  if (!reservation) return;
  if (succeeded) await services.guestService.completeUpload(reservation.reservationId);
  else await services.guestService.cancelUpload(reservation.reservationId);
}

async function handleDirectUpload(context, container, helpers) {
  const services = helpers.getServices(context);
  const auth = services.authService.checkAuthentication(context.req.raw);
  const body = await context.req.parseBody();
  const file = body.file;
  if (!(file instanceof File)) {
    return helpers.jsonError(context, 400, 'NO_FILE', 'No file uploaded.', 'Missing file.');
  }
  const buffer = await file.arrayBuffer();
  const maximumError = validateMaximum({
    context, fileSize: buffer.byteLength, limit: container.config.uploadMaxSize, helpers,
  });
  if (maximumError) return maximumError;
  const storageError = validateStorageLimit({
    context,
    fileSize: buffer.byteLength,
    storageMode: helpers.asString(body.storageMode || body.storage),
    container,
    helpers,
    audience: auth.authenticated ? 'admin' : 'guest',
  });
  if (storageError) return storageError;
  let reservation;
  try {
    reservation = await reserveGuestUpload({
      auth, services, request: context.req.raw, file, buffer,
    });
  } catch (error) {
    return helpers.jsonError(context, error.status || 503, error.code || 'GUEST_REJECTED', 'Guest upload is not allowed.', error.message);
  }
  const result = await performUpload({
    context, body, file, buffer, auth, reservation,
    uploadService: services.uploadService, helpers,
  });
  await settleGuestUpload({ services, reservation, succeeded: !(result instanceof Response) });
  if (result instanceof Response) return result;
  return helpers.uploadSuccessResponse(context, result);
}

function registerDirectUploadRoute(app, container, helpers) {
  app.post('/upload', (context) => handleDirectUpload(context, container, helpers));
}

module.exports = { registerDirectUploadRoute };
