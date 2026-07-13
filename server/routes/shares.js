const { verifyShareSignature } = require('../lib/utils/share-link');
const { decideDockerFileAccess } = require('../lib/services/file-access-service');
const {
  parseRangeRequest,
  parseRangeResponse,
} = require('../../shared/security/range-lease.cjs');

const LEASE_COOKIE_PREFIX = 'seraph_share_lease_';
const SUCCESSFUL_DELIVERY_STATUSES = new Set([200, 206]);
const SHARE_REQUEST_CODES = new Set([
  'SHARE_FILE_INVALID',
  'SHARE_ACCESS_VERSION_INVALID',
  'SHARE_TTL_INVALID',
  'SHARE_DOWNLOAD_LIMIT_INVALID',
]);
const SHARE_CONFIGURATION_CODES = new Set([
  'SHARE_SECRET_INVALID',
  'SHARE_SECRET_UNAVAILABLE',
]);

function shareError({ context, helpers, code, status = 400 }) {
  return helpers.jsonError(context, status, code, 'Share request failed.', code);
}

async function deliverShare({ context, services, helpers, fileId, headOnly = false }) {
  const result = await services.uploadService.getFileResponse(
    fileId,
    context.req.header('range'),
  );
  if (!result) return context.text('File not found', 404);
  const headers = helpers.buildFileProxyHeaders(result, result.response.headers);
  headers.set('Cache-Control', 'private, no-store');
  return new Response(headOnly ? null : result.response.body, {
    status: result.response.status, headers,
  });
}

function readLeaseCookie(context, shareId) {
  const name = `${LEASE_COOKIE_PREFIX}${shareId}`;
  const pair = (context.req.header('cookie') || '').split(';')
    .map((value) => value.trim())
    .find((value) => value.startsWith(`${name}=`));
  const [leaseId, token] = pair
    ? decodeURIComponent(pair.slice(name.length + 1)).split('.')
    : [];
  return leaseId && token ? Object.freeze({ leaseId, token }) : null;
}

function withLeaseCookie({ context, response, record, credentials, clear = false }) {
  const headers = new Headers(response.headers);
  const maxAge = clear ? 0 : Math.max(0, Math.floor((record.expiresAt - Date.now()) / 1000));
  const secure = new URL(context.req.url).protocol === 'https:' ? '; Secure' : '';
  const value = clear ? '' : `${credentials.leaseId}.${credentials.token}`;
  headers.append('Set-Cookie', `${LEASE_COOKIE_PREFIX}${record.shareId}=${value}; Max-Age=${maxAge}; Path=/; HttpOnly; SameSite=Strict${secure}`);
  return new Response(response.body, { status: response.status, headers });
}

function consumeSuccessfulDelivery(options) {
  const { context, services, record, request, response } = options;
  if (!SUCCESSFUL_DELIVERY_STATUSES.has(response.status)) return response;
  if (!request.rangeLimited) return response;
  const range = parseRangeResponse(response.headers.get('Content-Range'));
  if (request.range.present && (!range || range.start !== request.range.start)) {
    return context.text('File not found', 404);
  }
  if (request.lease) {
    const next = services.shareService.advanceLease({
      shareId: request.shareId,
      ...request.lease,
      nextOffset: range.nextOffset,
      complete: range.complete,
    });
    if (!next) return context.text('File not found', 404);
    return withLeaseCookie({
      context, response, record, credentials: next, clear: next.complete,
    });
  }
  if (!range || range.complete) {
    const consumed = services.shareService.consume(request);
    return consumed.ok ? response : context.text('File not found', 404);
  }
  const started = services.shareService.consumeAndStartLease({
    ...request, nextOffset: range.nextOffset,
  });
  if (!started.ok) return context.text('File not found', 404);
  return withLeaseCookie({
    context, response, record, credentials: started.credentials,
  });
}

async function servePrivateShare(context, helpers, headOnly = false) {
  const services = helpers.getServices(context);
  const shareId = context.req.param('shareId');
  const record = services.shareService.getById(shareId);
  if (!record) return context.text('File not found', 404);
  const file = services.fileRepo.getById(record.fileId);
  if (!file) return context.text('File not found', 404);
  const range = parseRangeRequest(context.req.header('range'));
  if (!range.valid) return context.text('File not found', 404);
  const rangeLimited = Number.isInteger(record.maxDownloads);
  const lease = rangeLimited && range.present
    ? readLeaseCookie(context, record.shareId)
    : null;
  if (rangeLimited && range.present && !lease && range.start !== 0) {
    return context.text('File not found', 404);
  }
  const request = {
    shareId,
    fileId: record.fileId,
    expiresAt: Number(context.req.query('exp')),
    accessVersion: file.metadata.accessVersion,
    signature: context.req.query('sig') || '',
    password: context.req.header('X-Share-Password') || '',
    lease: lease ? { ...lease, rangeStart: range.start } : null,
    range,
    rangeLimited,
  };
  const authorized = services.shareService.authorize(request);
  if (!authorized.ok) return context.text('File not found', 404);
  const response = await deliverShare({
    context, services, helpers, fileId: record.fileId, headOnly,
  });
  return headOnly ? response : consumeSuccessfulDelivery({
    context, services, record, request, response,
  });
}

function publicShareResponse(context, helpers, fileId) {
  const sharePath = `/file/${encodeURIComponent(fileId)}`;
  return context.json({
    success: true,
    permission: 'public-read',
    expiresAt: null,
    sharePath,
    shareUrl: helpers.toAbsoluteUrl(context, sharePath),
  });
}

function handleShareCreationError(context, helpers, error) {
  if (SHARE_REQUEST_CODES.has(error.code)) {
    return shareError({ context, helpers, code: error.code });
  }
  if (SHARE_CONFIGURATION_CODES.has(error.code)) {
    return shareError({ context, helpers, code: error.code, status: 503 });
  }
  console.error('share creation failed:', error);
  throw error;
}

async function createPrivateShare(context, helpers) {
  const unauthorized = helpers.requireAuth(context);
  if (unauthorized) return unauthorized;
  const services = helpers.getServices(context);
  const body = await context.req.json().catch(() => ({}));
  const fileId = helpers.asString(body.fileId || body.id).trim();
  const file = services.fileRepo.getById(fileId);
  if (!file) return shareError({
    context, helpers, code: 'FILE_ACCESS_DENIED', status: 404,
  });
  if (file.metadata.visibility === 'public') {
    return publicShareResponse(context, helpers, fileId);
  }
  try {
    const share = services.shareService.create({
      fileId,
      accessVersion: file.metadata.accessVersion,
      ttlSeconds: body.ttlSeconds === undefined ? undefined : Number(body.ttlSeconds),
      password: helpers.asString(body.password),
      maxDownloads: body.maxDownloads == null ? null : Number(body.maxDownloads),
    });
    const query = new URLSearchParams({
      exp: String(share.expiresAt), sig: share.signature,
    });
    const sharePath = `/s/${encodeURIComponent(share.shareId)}?${query.toString()}`;
    return context.json({
      success: true,
      permission: 'private-read-signed',
      expiresAt: share.expiresAt,
      shareId: share.shareId,
      sharePath,
      shareUrl: helpers.toAbsoluteUrl(context, sharePath),
    });
  } catch (error) {
    return handleShareCreationError(context, helpers, error);
  }
}

function revokeShare(context, helpers) {
  const unauthorized = helpers.requireAuth(context);
  if (unauthorized) return unauthorized;
  const result = helpers.getServices(context).shareService.revoke(
    context.req.param('shareId'),
  );
  return result.revoked
    ? context.json({ success: true, revoked: true })
    : shareError({ context, helpers, code: 'SHARE_NOT_FOUND', status: 404 });
}

async function serveLegacyShare(context, container, helpers) {
  const fileId = decodeURIComponent(context.req.param('id'));
  const expiresAt = Number(context.req.query('exp') || 0);
  const accessVersion = Number(context.req.query('av') || 0);
  const signature = context.req.query('sig') || '';
  const secret = container.config.sessionSecret || container.config.configEncryptionKey;
  if (!verifyShareSignature({ fileId, expiresAt, accessVersion, signature, secret })) {
    return context.text('File not found', 404);
  }
  const services = helpers.getServices(context);
  const file = services.fileRepo.getById(fileId);
  const share = { expiresAt: Math.floor(expiresAt / 1000), accessVersion, revoked: false };
  if (!file || !decideDockerFileAccess({
    file, request: context.req.raw, authService: services.authService, share,
  }).allowed) return context.text('File not found', 404);
  return deliverShare({ context, services, helpers, fileId });
}

function registerShareRoutes(app, container, helpers) {
  app.on(['GET', 'HEAD'], '/s/:shareId', (context) => servePrivateShare(
    context,
    helpers,
    context.req.method === 'HEAD',
  ));
  app.options('/s/:shareId', (context) => context.body(null, 204));
  app.post('/api/share/sign', (context) => createPrivateShare(context, helpers));
  app.post('/api/share/:shareId/revoke', (context) => revokeShare(context, helpers));
  app.get('/share/:id', (context) => serveLegacyShare(context, container, helpers));
  app.options('/share/:id', (context) => context.body(null, 204));
}

module.exports = { registerShareRoutes };
