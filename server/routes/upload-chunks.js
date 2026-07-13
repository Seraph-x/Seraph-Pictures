const { normalizeFolderPath } = require('../lib/repos/file-repo');

function validateMaximum({ context, fileSize, container, helpers }) {
  if (fileSize <= container.config.uploadMaxSize) return null;
  const megabytes = Math.floor(container.config.uploadMaxSize / 1024 / 1024);
  return helpers.jsonError(
    context,
    413,
    'FILE_TOO_LARGE',
    'File exceeds upload size limit.',
    `Upload limit is ${megabytes}MB.`,
  );
}

function validateStoragePlan({ context, fileSize, storageMode, container, helpers }) {
  const type = storageMode || container.config.bootstrapDefaultStorage?.type || 'telegram';
  const limit = helpers.getUploadLimits()[type];
  if (!limit) return null;
  if (fileSize > limit.maxBytes) {
    const megabytes = Math.floor(limit.maxBytes / 1024 / 1024);
    return helpers.jsonError(
      context,
      413,
      'STORAGE_FILE_TOO_LARGE',
      'File exceeds selected storage limit.',
      limit.message || `Selected storage limit is ${megabytes}MB.`,
    );
  }
  if (fileSize <= limit.directThreshold || limit.supportsChunkUpload !== false) return null;
  return helpers.jsonError(
    context,
    400,
    'STORAGE_CHUNK_UNSUPPORTED',
    'Selected storage does not support chunk upload.',
    limit.message || 'Choose another storage backend for this file size.',
  );
}

function createTask(options) {
  const { body, fileSize, totalChunks, storageMode, service, helpers, auth } = options;
  return service.initTask({
    fileName: body.fileName,
    fileSize,
    fileType: body.fileType,
    totalChunks,
    storageMode,
    storageId: helpers.asString(body.storageId),
    folderPath: normalizeFolderPath(body.folderPath || body.folder || ''),
    uploadSource: auth.authenticated ? 'image-host' : 'guest',
    visibility: 'public',
  });
}

async function handleInit(context, container, helpers) {
  const services = helpers.getServices(context);
  const auth = services.authService.checkAuthentication(context.req.raw);
  if (!auth.authenticated && services.authService.isAuthRequired()) {
    return helpers.jsonError(context, 403, 'GUEST_CHUNK_DISABLED', 'Guest users cannot use chunk upload.', 'Login required for chunk uploads.');
  }
  const body = await context.req.json().catch(() => ({}));
  const fileSize = Number(body.fileSize || 0);
  const totalChunks = Number(body.totalChunks || 0);
  if (!body.fileName || !fileSize || !totalChunks) {
    return helpers.jsonError(context, 400, 'MISSING_PARAMS', 'Missing required parameters.', 'fileName, fileSize and totalChunks are required.');
  }
  const maximumError = validateMaximum({ context, fileSize, container, helpers });
  if (maximumError) return maximumError;
  const storageMode = helpers.asString(body.storageMode);
  const storageError = validateStoragePlan({ context, fileSize, storageMode, container, helpers });
  if (storageError) return storageError;
  try {
    const init = createTask({
      body, fileSize, totalChunks, storageMode, service: services.chunkService, helpers, auth,
    });
    return context.json({ success: true, ...init });
  } catch (error) {
    return helpers.jsonError(context, error.status || 400, error.code || 'INVALID_CHUNK_PLAN', error.message, error.message);
  }
}

function handleGetInit(context, helpers) {
  const { chunkService } = helpers.getServices(context);
  const uploadId = context.req.query('uploadId');
  if (!uploadId) return helpers.jsonError(context, 400, 'UPLOAD_ID_REQUIRED', 'uploadId is required.', 'Query parameter uploadId is missing.');
  const task = chunkService.getTask(uploadId);
  if (!task) return helpers.jsonError(context, 404, 'UPLOAD_TASK_NOT_FOUND', 'Upload task not found.', 'uploadId not found or expired.');
  return context.json({ success: true, task });
}

async function handleChunk(context, helpers) {
  const services = helpers.getServices(context);
  const unauthorized = services.authService.isAuthRequired() ? helpers.requireAuth(context) : null;
  if (unauthorized) return unauthorized;
  const body = await context.req.parseBody();
  const uploadId = helpers.asString(body.uploadId);
  const chunkIndex = Number(body.chunkIndex);
  if (!uploadId || Number.isNaN(chunkIndex) || !(body.chunk instanceof File)) {
    return helpers.jsonError(context, 400, 'MISSING_PARAMS', 'Missing required parameters.', 'uploadId, chunkIndex and chunk are required.');
  }
  try {
    await services.chunkService.saveChunk({
      uploadId,
      chunkIndex,
      buffer: await body.chunk.arrayBuffer(),
    });
    return context.json({ success: true, chunkIndex });
  } catch (error) {
    return helpers.jsonError(context, error.status || 400, error.code || 'CHUNK_UPLOAD_FAILED', error.message, error.message);
  }
}

function completeResponse(context, result) {
  return context.json({
    success: true,
    src: result.src,
    fileName: result.file.file_name,
    fileSize: result.file.file_size,
    fileId: result.file.id,
    folderPath: result.file.metadata?.folderPath || '',
  });
}

async function handleComplete(context, helpers) {
  const services = helpers.getServices(context);
  const unauthorized = services.authService.isAuthRequired() ? helpers.requireAuth(context) : null;
  if (unauthorized) return unauthorized;
  const body = await context.req.json().catch(() => ({}));
  if (!body.uploadId) return helpers.jsonError(context, 400, 'UPLOAD_ID_REQUIRED', 'uploadId is required.', 'Request body uploadId is missing.');
  try {
    return completeResponse(context, await services.chunkService.complete(body.uploadId));
  } catch (error) {
    const status = error.status || 502;
    const normalized = helpers.normalizeUploadError(context, error, status);
    return context.json({ ...normalized, traceId: helpers.getTraceId(context) }, status);
  }
}

function registerChunkUploadRoutes(app, container, helpers) {
  app.post('/api/chunked-upload/init', (context) => handleInit(context, container, helpers));
  app.get('/api/chunked-upload/init', (context) => handleGetInit(context, helpers));
  app.post('/api/chunked-upload/chunk', (context) => handleChunk(context, helpers));
  app.post('/api/chunked-upload/complete', (context) => handleComplete(context, helpers));
}

module.exports = { registerChunkUploadRoutes };
