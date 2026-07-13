const crypto = require('node:crypto');
const { Hono } = require('hono');
const { createContainer } = require('./lib/container');
const { toStorageErrorPayload } = require('./lib/utils/storage-error');
const { createRouteHelpers } = require('./routes/_shared');
const { registerAuthRoutes } = require('./routes/auth');
const { registerSettingsRoutes } = require('./routes/settings');
const { registerStorageRoutes } = require('./routes/storage');
const { registerStatusRoutes } = require('./routes/status');
const { registerUploadRoutes } = require('./routes/upload');
const { registerFileRoutes } = require('./routes/files');
const { registerManageRoutes } = require('./routes/manage');
const { registerTelegramRoutes } = require('./routes/telegram');
const { registerVisibilityRoutes } = require('./routes/visibility');
const { registerShareRoutes } = require('./routes/shares');

const CORS_ALLOW_METHODS = 'GET,POST,PUT,PATCH,DELETE,OPTIONS';
const CORS_ALLOW_HEADERS = 'Content-Type, Authorization, Range, X-Seraph-Client, X-Share-Password, Accept';
const CORS_EXPOSE_HEADERS = 'Content-Length, Content-Range, Accept-Ranges, Content-Disposition';

function createCorsMiddleware(env = {}) {
  const allowedOrigins = parseCorsOrigins(env.CORS_ORIGINS);
  return async (c, next) => {
    const origin = c.req.header('origin') || '';
    const allowOrigin = resolveAllowedOrigin(origin, c.req.url, allowedOrigins);
    if (allowOrigin) applyCorsHeaders(c, allowOrigin);
    if (c.req.method === 'OPTIONS') return preflightResponse(c, allowOrigin);
    await next();
    c.header('Vary', 'Origin', { append: true });
  };
}

function parseCorsOrigins(value) {
  return new Set(String(value || '').split(',').map((item) => item.trim()).filter(Boolean));
}

function resolveAllowedOrigin(origin, requestUrl, allowedOrigins) {
  if (!origin) return '';
  const sameOrigin = new URL(requestUrl).origin;
  if (origin === sameOrigin) return origin;
  if (allowedOrigins.has(origin)) return origin;
  return '';
}

function applyCorsHeaders(c, origin) {
  c.header('Access-Control-Allow-Origin', origin);
  c.header('Access-Control-Allow-Credentials', 'true');
  c.header('Access-Control-Expose-Headers', CORS_EXPOSE_HEADERS);
}

function preflightResponse(c, allowOrigin) {
  if (!allowOrigin) return new Response(null, { status: 204 });
  c.header('Access-Control-Allow-Methods', CORS_ALLOW_METHODS);
  c.header('Access-Control-Allow-Headers', CORS_ALLOW_HEADERS);
  return new Response(null, { headers: c.res.headers, status: 204 });
}

function createApp() {
  const app = new Hono();
  const container = createContainer(process.env);
  const helpers = createRouteHelpers(container);

  app.use('*', createCorsMiddleware(process.env));

  app.use('*', async (c, next) => {
    const traceId = crypto.randomUUID();
    c.set('traceId', traceId);
    c.header('X-Trace-Id', traceId);
    c.set('container', container);
    try {
      await next();
    } catch (error) {
      console.error(error);
      const payload = toStorageErrorPayload(error, 500);
      const envelope = {
        success: false,
        error: {
          code: payload.code || 'INTERNAL_ERROR',
          message: payload.message || 'Internal Server Error',
          detail: payload.detail || String(error?.message || 'unknown'),
          retriable: payload.retriable === true,
        },
        traceId,
      };

      if (helpers.prefersV2Envelope(c)) {
        return c.json(envelope, 500);
      }

      return c.json({
        success: false,
        error: envelope.error.message,
        errorCode: envelope.error.code,
        errorDetail: envelope.error.detail,
        retriable: envelope.error.retriable,
        traceId,
      }, 500);
    }
  });

  registerAuthRoutes(app, container, helpers);
  registerSettingsRoutes(app, container, helpers);
  registerStatusRoutes(app, container, helpers);
  registerStorageRoutes(app, container, helpers);
  registerUploadRoutes(app, container, helpers);
  registerFileRoutes(app, container, helpers);
  registerShareRoutes(app, container, helpers);
  registerManageRoutes(app, container, helpers);
  registerVisibilityRoutes(app, container, helpers);
  registerTelegramRoutes(app, container, helpers);

  return app;
}

module.exports = {
  createApp,
};
