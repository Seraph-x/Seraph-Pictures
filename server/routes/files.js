const { decideDockerFileAccess } = require('../lib/services/file-access-service');
const { parseSignedTelegramFileId } = require('../lib/utils/telegram-webhook');

function canReadFile({ file, request, authService }) {
  return decideDockerFileAccess({ file, request, authService }).allowed;
}

function registerInfoRoute(app, helpers) {
  app.get('/api/file-info/:id', (context) => {
    const { fileRepo, authService } = helpers.getServices(context);
    const id = decodeURIComponent(context.req.param('id'));
    const file = fileRepo.getById(id);
    if (!file || !canReadFile({ file, request: context.req.raw, authService })) {
      return helpers.jsonError(
        context, 404, 'FILE_NOT_FOUND', 'File not found.', `File "${id}" does not exist.`, false,
      );
    }
    return context.json({
      success: true,
      fileId: file.id,
      key: file.id,
      fileName: file.file_name,
      originalName: file.file_name,
      fileSize: file.file_size,
      uploadTime: file.created_at,
      storageType: file.storage_type,
      listType: file.list_type,
      label: file.label,
      liked: Boolean(file.liked),
      folderPath: file.metadata?.folderPath || '',
      visibility: file.metadata.visibility,
      accessVersion: file.metadata.accessVersion,
    });
  });
}

async function signedResponse({ context, id, range, storageRepo, helpers, headOnly }) {
  try {
    return await helpers.handleSignedTelegramFile({
      id, range, storageRepo, context, headOnly,
    });
  } catch (error) {
    console.error('signed telegram file proxy error:', error);
    return headOnly
      ? context.body(null, 502)
      : context.text(`Signed file proxy error: ${error?.message || 'Unknown error'}`, 502);
  }
}

async function regularResponse({ context, id, range, services, helpers, headOnly }) {
  const { fileRepo, authService, uploadService } = services;
  const file = fileRepo.getById(id);
  if (!file || !canReadFile({ file, request: context.req.raw, authService })) {
    return headOnly ? context.body(null, 404) : context.text('File not found', 404);
  }
  try {
    const result = await uploadService.getFileResponse(id, range);
    if (!result) return headOnly ? context.body(null, 404) : context.text('File not found', 404);
    const headers = helpers.buildFileProxyHeaders(result, result.response.headers);
    return new Response(headOnly ? null : result.response.body, {
      status: result.response.status,
      statusText: result.response.statusText,
      headers,
    });
  } catch (error) {
    console.error('file proxy route error:', error);
    return headOnly
      ? context.body(null, 502, { 'X-File-Proxy-Error': String(error.message).slice(0, 200) })
      : context.text(`File proxy error: ${error?.message || 'Unknown error'}`, 502);
  }
}

async function serveFile({ context, container, helpers, headOnly = false }) {
  const services = helpers.getServices(context);
  const id = decodeURIComponent(context.req.param('id'));
  const range = context.req.header('range');
  if (id.startsWith('tgs_')) {
    const parsed = parseSignedTelegramFileId(id, {
      ...process.env, FILE_URL_SECRET: container.config.configEncryptionKey,
    });
    const canonicalId = parsed ? `${parsed.fileId}.${parsed.fileExtension}` : '';
    const file = canonicalId ? services.fileRepo.getById(canonicalId) : null;
    if (!file || !canReadFile({
      file, request: context.req.raw, authService: services.authService,
    })) return headOnly ? context.body(null, 404) : context.text('File not found', 404);
    return signedResponse({
      context, id, range, storageRepo: services.storageRepo, helpers, headOnly,
    });
  }
  return regularResponse({ context, id, range, services, helpers, headOnly });
}

function registerFileRoutes(app, container, helpers) {
  registerInfoRoute(app, helpers);
  app.on(['GET', 'HEAD'], '/file/:id', (context) => serveFile({
    context,
    container,
    helpers,
    headOnly: context.req.method === 'HEAD',
  }));
  app.options('/file/:id', (context) => context.body(null, 204));
}

module.exports = { registerFileRoutes };
