const { createShareSignature, verifyShareSignature } = require('../lib/utils/share-link');
const { decideDockerFileAccess } = require('../lib/services/file-access-service');

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
    return await helpers.handleSignedTelegramFile(id, range, storageRepo, context, headOnly);
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

async function serveFile(context, helpers, headOnly = false) {
  const services = helpers.getServices(context);
  const id = decodeURIComponent(context.req.param('id'));
  const range = context.req.header('range');
  if (id.startsWith('tgs_')) {
    return signedResponse({
      context, id, range, storageRepo: services.storageRepo, helpers, headOnly,
    });
  }
  return regularResponse({ context, id, range, services, helpers, headOnly });
}

async function serveLegacyShare(context, container, helpers) {
  const fileId = decodeURIComponent(context.req.param('id'));
  const expiresAt = Number(context.req.query('exp') || 0);
  const accessVersion = Number(context.req.query('av') || 0);
  const signature = context.req.query('sig') || '';
  if (!Number.isFinite(expiresAt) || expiresAt <= 0
    || !Number.isInteger(accessVersion) || accessVersion < 1) {
    return context.text('Invalid share envelope.', 400);
  }
  if (Date.now() > expiresAt) return context.text('Share link expired.', 410);
  const secret = container.config.sessionSecret || container.config.configEncryptionKey;
  if (!verifyShareSignature({ fileId, expiresAt, accessVersion, signature, secret })) {
    return context.text('Invalid share signature.', 403);
  }
  const services = helpers.getServices(context);
  const file = services.fileRepo.getById(fileId);
  const share = { expiresAt: Math.floor(expiresAt / 1000), accessVersion, revoked: false };
  if (!file || !decideDockerFileAccess({
    file, request: context.req.raw, authService: services.authService, share,
  }).allowed) return context.text('File not found', 404);
  try {
    const result = await services.uploadService.getFileResponse(
      fileId,
      context.req.header('range'),
    );
    if (!result) return context.text('File not found', 404);
    const headers = helpers.buildFileProxyHeaders(result, result.response.headers);
    headers.set('Cache-Control', 'private, max-age=60');
    return new Response(result.response.body, { status: result.response.status, headers });
  } catch (error) {
    console.error('share proxy route error:', error);
    return context.text(`Share proxy error: ${error?.message || 'Unknown error'}`, 502);
  }
}

async function signLegacyShare(context, container, helpers) {
  const unauthorized = helpers.requireAuth(context);
  if (unauthorized) return unauthorized;
  const body = await context.req.json().catch(() => ({}));
  const fileId = helpers.asString(body.fileId || body.id).trim();
  if (!fileId) {
    return helpers.jsonError(context, 400, 'FILE_ID_REQUIRED', 'fileId is required.', 'Provide fileId.');
  }
  const file = helpers.getServices(context).fileRepo.getById(fileId);
  if (!file) return helpers.jsonError(context, 404, 'FILE_NOT_FOUND', 'File not found.', 'Unknown file.');
  const expiresAt = helpers.parseShareExpiry(body.ttlSeconds || body.expiresIn || body.ttl);
  const accessVersion = file.metadata.accessVersion;
  const secret = container.config.sessionSecret || container.config.configEncryptionKey;
  const signature = createShareSignature({ fileId, expiresAt, accessVersion, secret });
  const sharePath = `/share/${encodeURIComponent(fileId)}?exp=${expiresAt}&av=${accessVersion}&sig=${encodeURIComponent(signature)}`;
  return context.json({
    success: true,
    permission: 'public-read-signed',
    expiresAt,
    sharePath,
    shareUrl: helpers.toAbsoluteUrl(context, sharePath),
    directPath: `/file/${encodeURIComponent(fileId)}`,
    directUrl: helpers.toAbsoluteUrl(context, `/file/${encodeURIComponent(fileId)}`),
  });
}

function registerFileRoutes(app, container, helpers) {
  registerInfoRoute(app, helpers);
  app.get('/file/:id', (context) => serveFile(context, helpers));
  app.options('/file/:id', (context) => context.body(null, 204));
  app.on('HEAD', '/file/:id', (context) => serveFile(context, helpers, true));
  app.get('/share/:id', (context) => serveLegacyShare(context, container, helpers));
  app.options('/share/:id', (context) => context.body(null, 204));
  app.post('/api/share/sign', (context) => signLegacyShare(context, container, helpers));
}

module.exports = { registerFileRoutes };
