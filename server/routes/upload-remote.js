const { normalizeFolderPath } = require('../lib/repos/file-repo');

async function performRemoteUpload({ context, payload, auth, service, container, helpers }) {
  try {
    return await service.uploadFromUrl({
      url: payload.url,
      storageMode: helpers.asString(payload.storageMode || payload.storage),
      storageId: helpers.asString(payload.storageId || payload.storage_config_id),
      folderPath: normalizeFolderPath(payload.folderPath || payload.folder || ''),
      maxBytes: Math.min(container.config.uploadSmallFileThreshold, container.config.uploadMaxSize),
      uploadSource: auth.authenticated ? 'image-host' : 'guest',
      visibility: 'public',
    });
  } catch (error) {
    const status = error?.status || 502;
    const normalized = helpers.normalizeUploadError(context, error, status);
    return context.json({ ...normalized, traceId: helpers.getTraceId(context) }, status);
  }
}

async function handleRemoteUpload(context, container, helpers) {
  const services = helpers.getServices(context);
  const auth = services.authService.checkAuthentication(context.req.raw);
  const payload = await context.req.json().catch(() => ({}));
  if (!payload.url) {
    return helpers.jsonError(context, 400, 'URL_REQUIRED', 'url is required.', 'Missing url.');
  }
  if (!auth.authenticated) {
    const guest = services.guestService.checkUploadAllowed(context.req.raw, 0);
    if (!guest.allowed) return helpers.jsonError(context, guest.status || 403, 'GUEST_REJECTED', 'Guest upload is not allowed.', guest.reason);
  }
  const result = await performRemoteUpload({
    context,
    payload,
    auth,
    service: services.uploadService,
    container,
    helpers,
  });
  if (result instanceof Response) return result;
  if (!auth.authenticated) services.guestService.incrementUsage(context.req.raw);
  return helpers.uploadSuccessResponse(context, result);
}

function registerRemoteUploadRoute(app, container, helpers) {
  app.post('/api/upload-from-url', (context) => handleRemoteUpload(context, container, helpers));
}

module.exports = { registerRemoteUploadRoute };
