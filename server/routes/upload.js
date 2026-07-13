const { normalizeFolderPath } = require('../lib/repos/file-repo');

function registerUploadRoutes(app, container, helpers) {
  const {
    getServices,
    getTraceId,
    jsonError,
    asString,
    requireAuth,
    normalizeUploadError,
    getUploadLimits,
    uploadSuccessResponse,
  } = helpers;

  app.post('/upload', async (c) => {
    const { authService, guestService, uploadService } = getServices(c);
    const auth = authService.checkAuthentication(c.req.raw);

    const body = await c.req.parseBody();
    const file = body.file;
    if (!(file instanceof File)) {
      return jsonError(c, 400, 'NO_FILE', 'No file uploaded.', 'Multipart body missing "file".');
    }

    const fileBuffer = await file.arrayBuffer();
    const fileSize = fileBuffer.byteLength;

    if (fileSize > container.config.uploadMaxSize) {
      return jsonError(
        c,
        413,
        'FILE_TOO_LARGE',
        'File exceeds upload size limit.',
        `Upload limit is ${Math.floor(container.config.uploadMaxSize / 1024 / 1024)}MB.`
      );
    }

    if (!auth.authenticated) {
      const guestCheck = guestService.checkUploadAllowed(c.req.raw, fileSize);
      if (!guestCheck.allowed) {
        return jsonError(c, guestCheck.status || 403, 'GUEST_REJECTED', 'Guest upload is not allowed.', guestCheck.reason);
      }
    }

    const storageMode = asString(body.storageMode || body.storage);
    const storageModeForLimit = storageMode || container.config.bootstrapDefaultStorage?.type || 'telegram';
    const uploadLimit = getUploadLimits()[storageModeForLimit];
    if (uploadLimit && fileSize > uploadLimit.maxBytes) {
      return jsonError(
        c,
        413,
        'STORAGE_FILE_TOO_LARGE',
        'File exceeds selected storage limit.',
        uploadLimit.message || `Selected storage limit is ${Math.floor(uploadLimit.maxBytes / 1024 / 1024)}MB.`
      );
    }

    let result;
    try {
      result = await uploadService.uploadFile({
        fileName: file.name,
        mimeType: file.type,
        fileSize,
        buffer: fileBuffer,
        storageMode,
        storageId: asString(body.storageId || body.storage_config_id),
        folderPath: normalizeFolderPath(body.folderPath || body.folder || ''),
      });
    } catch (error) {
      const normalized = normalizeUploadError(c, error, 502);
      return c.json({ ...normalized, traceId: getTraceId(c) }, 502);
    }

    if (!auth.authenticated) {
      guestService.incrementUsage(c.req.raw);
    }

    return uploadSuccessResponse(c, result);
  });

  app.post('/api/upload-from-url', async (c) => {
    const { authService, guestService, uploadService } = getServices(c);
    const auth = authService.checkAuthentication(c.req.raw);
    const payload = await c.req.json().catch(() => ({}));

    if (!payload.url) {
      return jsonError(c, 400, 'URL_REQUIRED', 'url is required.', 'Missing request body field "url".');
    }

    if (!auth.authenticated) {
      const guestCheck = guestService.checkUploadAllowed(c.req.raw, 0);
      if (!guestCheck.allowed) {
        return jsonError(c, guestCheck.status || 403, 'GUEST_REJECTED', 'Guest upload is not allowed.', guestCheck.reason);
      }
    }

    let result;
    try {
      result = await uploadService.uploadFromUrl({
        url: payload.url,
        storageMode: asString(payload.storageMode || payload.storage),
        storageId: asString(payload.storageId || payload.storage_config_id),
        folderPath: normalizeFolderPath(payload.folderPath || payload.folder || ''),
        maxBytes: Math.min(container.config.uploadSmallFileThreshold, container.config.uploadMaxSize),
      });
    } catch (error) {
      const status = error?.status || 502;
      const normalized = normalizeUploadError(c, error, status);
      return c.json({ ...normalized, traceId: getTraceId(c) }, status);
    }

    if (!auth.authenticated) {
      guestService.incrementUsage(c.req.raw);
    }

    return uploadSuccessResponse(c, result);
  });

  app.post('/api/chunked-upload/init', async (c) => {
    const { authService, chunkService } = getServices(c);
    const auth = authService.checkAuthentication(c.req.raw);
    if (!auth.authenticated && authService.isAuthRequired()) {
      return jsonError(c, 403, 'GUEST_CHUNK_DISABLED', 'Guest users cannot use chunk upload.', 'Login required for chunk uploads.');
    }

    const body = await c.req.json().catch(() => ({}));
    const fileSize = Number(body.fileSize || 0);
    const totalChunks = Number(body.totalChunks || 0);

    if (!body.fileName || !fileSize || !totalChunks) {
      return jsonError(c, 400, 'MISSING_PARAMS', 'Missing required parameters.', 'fileName, fileSize and totalChunks are required.');
    }

    if (fileSize > container.config.uploadMaxSize) {
      return jsonError(
        c,
        413,
        'FILE_TOO_LARGE',
        'File exceeds upload size limit.',
        `Upload limit is ${Math.floor(container.config.uploadMaxSize / 1024 / 1024)}MB.`
      );
    }

    const storageMode = asString(body.storageMode);
    const storageModeForLimit = storageMode || container.config.bootstrapDefaultStorage?.type || 'telegram';
    const uploadLimit = getUploadLimits()[storageModeForLimit];
    if (uploadLimit) {
      if (fileSize > uploadLimit.maxBytes) {
        return jsonError(
          c,
          413,
          'STORAGE_FILE_TOO_LARGE',
          'File exceeds selected storage limit.',
          uploadLimit.message || `Selected storage limit is ${Math.floor(uploadLimit.maxBytes / 1024 / 1024)}MB.`
        );
      }
      if (fileSize > uploadLimit.directThreshold && uploadLimit.supportsChunkUpload === false) {
        return jsonError(
          c,
          400,
          'STORAGE_CHUNK_UNSUPPORTED',
          'Selected storage does not support chunk upload.',
          uploadLimit.message || 'Choose another storage backend for this file size.'
        );
      }
    }

    let init;
    try {
      init = chunkService.initTask({
        fileName: body.fileName,
        fileSize,
        fileType: body.fileType,
        totalChunks,
        storageMode,
        storageId: asString(body.storageId),
        folderPath: normalizeFolderPath(body.folderPath || body.folder || ''),
      });
    } catch (error) {
      return jsonError(c, error.status || 400, error.code || 'INVALID_CHUNK_PLAN', error.message, error.message);
    }

    return c.json({ success: true, ...init });
  });

  app.get('/api/chunked-upload/init', (c) => {
    const { chunkService } = getServices(c);
    const uploadId = c.req.query('uploadId');
    if (!uploadId) return jsonError(c, 400, 'UPLOAD_ID_REQUIRED', 'uploadId is required.', 'Query parameter uploadId is missing.');

    const task = chunkService.getTask(uploadId);
    if (!task) return jsonError(c, 404, 'UPLOAD_TASK_NOT_FOUND', 'Upload task not found.', 'uploadId not found or expired.');

    return c.json({ success: true, task });
  });

  app.post('/api/chunked-upload/chunk', async (c) => {
    const { authService, chunkService } = getServices(c);
    const unauthorized = authService.isAuthRequired() ? requireAuth(c) : null;
    if (unauthorized) return unauthorized;

    const body = await c.req.parseBody();
    const uploadId = asString(body.uploadId);
    const chunkIndex = Number(body.chunkIndex);
    const chunk = body.chunk;

    if (!uploadId || Number.isNaN(chunkIndex) || !(chunk instanceof File)) {
      return jsonError(c, 400, 'MISSING_PARAMS', 'Missing required parameters.', 'uploadId, chunkIndex and chunk are required.');
    }

    const buffer = await chunk.arrayBuffer();
    try {
      await chunkService.saveChunk({ uploadId, chunkIndex, buffer });
    } catch (error) {
      return jsonError(c, error.status || 400, error.code || 'CHUNK_UPLOAD_FAILED', error.message, error.message);
    }

    return c.json({ success: true, chunkIndex });
  });

  app.post('/api/chunked-upload/complete', async (c) => {
    const { authService, chunkService } = getServices(c);
    const unauthorized = authService.isAuthRequired() ? requireAuth(c) : null;
    if (unauthorized) return unauthorized;

    const body = await c.req.json().catch(() => ({}));
    if (!body.uploadId) return jsonError(c, 400, 'UPLOAD_ID_REQUIRED', 'uploadId is required.', 'Request body uploadId is missing.');

    let result;
    try {
      result = await chunkService.complete(body.uploadId);
    } catch (error) {
      const status = error.status || 502;
      const normalized = normalizeUploadError(c, error, status);
      return c.json({ ...normalized, traceId: getTraceId(c) }, status);
    }

    return c.json({
      success: true,
      src: result.src,
      fileName: result.file.file_name,
      fileSize: result.file.file_size,
      fileId: result.file.id,
      folderPath: result.file.metadata?.folderPath || '',
    });
  });
}

module.exports = {
  registerUploadRoutes,
};
