const { normalizeFolderPath } = require('../lib/repos/file-repo');

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

function validateStorageLimit({ context, fileSize, storageMode, container, helpers }) {
  const type = storageMode || container.config.bootstrapDefaultStorage?.type || 'telegram';
  const limit = helpers.getUploadLimits()[type];
  if (!limit || fileSize <= limit.maxBytes) return null;
  return helpers.jsonError(
    context,
    413,
    'STORAGE_FILE_TOO_LARGE',
    'File exceeds selected storage limit.',
    limit.message || `Selected storage limit is ${Math.floor(limit.maxBytes / 1024 / 1024)}MB.`,
  );
}

async function performUpload(options) {
  const { context, body, file, buffer, auth, reservation, uploadService, helpers } = options;
  try {
    return await uploadService.uploadFile({
      fileName: file.name,
      mimeType: file.type,
      fileSize: buffer.byteLength,
      buffer,
      storageMode: helpers.asString(body.storageMode || body.storage),
      storageId: reservation?.storageId
        || helpers.asString(body.storageId || body.storage_config_id),
      folderPath: normalizeFolderPath(body.folderPath || body.folder || ''),
      uploadSource: auth.authenticated ? 'image-host' : 'guest',
      visibility: 'public',
      expiresAt: reservation?.fileExpiresAt,
      retentionDays: reservation?.retentionDays,
    });
  } catch (error) {
    const normalized = helpers.normalizeUploadError(context, error, 502);
    return context.json({ ...normalized, traceId: helpers.getTraceId(context) }, 502);
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
  let reservation;
  try {
    reservation = await reserveGuestUpload({
      auth, services, request: context.req.raw, file, buffer,
    });
  } catch (error) {
    return helpers.jsonError(context, error.status || 503, error.code || 'GUEST_REJECTED', 'Guest upload is not allowed.', error.message);
  }
  const storageError = validateStorageLimit({
    context,
    fileSize: buffer.byteLength,
    storageMode: helpers.asString(body.storageMode || body.storage),
    container,
    helpers,
  });
  if (storageError) {
    await settleGuestUpload({ services, reservation, succeeded: false });
    return storageError;
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
