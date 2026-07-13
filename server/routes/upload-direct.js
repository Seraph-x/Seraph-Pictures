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
  const { context, body, file, buffer, auth, uploadService, helpers } = options;
  try {
    return await uploadService.uploadFile({
      fileName: file.name,
      mimeType: file.type,
      fileSize: buffer.byteLength,
      buffer,
      storageMode: helpers.asString(body.storageMode || body.storage),
      storageId: helpers.asString(body.storageId || body.storage_config_id),
      folderPath: normalizeFolderPath(body.folderPath || body.folder || ''),
      uploadSource: auth.authenticated ? 'image-host' : 'guest',
      visibility: 'public',
    });
  } catch (error) {
    const normalized = helpers.normalizeUploadError(context, error, 502);
    return context.json({ ...normalized, traceId: helpers.getTraceId(context) }, 502);
  }
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
  if (!auth.authenticated) {
    const guest = services.guestService.checkUploadAllowed(context.req.raw, buffer.byteLength);
    if (!guest.allowed) return helpers.jsonError(context, guest.status || 403, 'GUEST_REJECTED', 'Guest upload is not allowed.', guest.reason);
  }
  const storageError = validateStorageLimit({
    context,
    fileSize: buffer.byteLength,
    storageMode: helpers.asString(body.storageMode || body.storage),
    container,
    helpers,
  });
  if (storageError) return storageError;
  const result = await performUpload({
    context, body, file, buffer, auth, uploadService: services.uploadService, helpers,
  });
  if (result instanceof Response) return result;
  if (!auth.authenticated) services.guestService.incrementUsage(context.req.raw);
  return helpers.uploadSuccessResponse(context, result);
}

function registerDirectUploadRoute(app, container, helpers) {
  app.post('/upload', (context) => handleDirectUpload(context, container, helpers));
}

module.exports = { registerDirectUploadRoute };
