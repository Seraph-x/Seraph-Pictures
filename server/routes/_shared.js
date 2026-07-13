const crypto = require('node:crypto');
const { toStorageErrorPayload } = require('../lib/utils/storage-error');
const { parseSignedTelegramFileId } = require('../lib/utils/telegram-webhook');
const { createUploadCapabilityHelpers } = require('./upload-capabilities');

function createRouteHelpers(container) {
  const uploadCapabilities = createUploadCapabilityHelpers(container.config);
  function getServices(c) {
    return c.get('container');
  }

  function getTraceId(c) {
    return c.get('traceId') || crypto.randomUUID();
  }

  function prefersV2Envelope(c) {
    const client = String(c.req.header('X-Seraph-Client') || '').toLowerCase();
    const accept = String(c.req.header('accept') || '').toLowerCase();
    return client === 'app-v2' || accept.includes('application/vnd.seraph.v2+json');
  }

  function jsonError(c, statusCode, code, message, detail, retriable = false, extra = {}) {
    const traceId = getTraceId(c);
    const errorInfo = {
      code: String(code || 'ERROR'),
      message: String(message || 'Request failed'),
      detail: String(detail || message || 'Request failed'),
      retriable: Boolean(retriable),
    };

    if (prefersV2Envelope(c)) {
      return c.json({
        success: false,
        error: errorInfo,
        traceId,
        ...extra,
      }, statusCode);
    }

    return c.json({
      success: false,
      error: errorInfo.message,
      errorCode: errorInfo.code,
      errorDetail: errorInfo.detail,
      retriable: errorInfo.retriable,
      traceId,
      ...extra,
    }, statusCode);
  }

  function methodNotAllowed(c, allow) {
    c.header('Allow', allow);
    return jsonError(
      c,
      405,
      'METHOD_NOT_ALLOWED',
      'Method not allowed.',
      `Use ${allow} for this endpoint.`
    );
  }

  function asString(value, fallback = '') {
    if (value == null) return fallback;
    if (Array.isArray(value)) return asString(value[0], fallback);
    if (value instanceof File) return fallback;
    return String(value);
  }

  function firstNonEmpty(...values) {
    for (const value of values) {
      if (value == null) continue;
      if (Array.isArray(value)) {
        const nested = firstNonEmpty(...value);
        if (nested != null) return nested;
        continue;
      }
      if (value instanceof File) continue;
      const normalized = String(value).trim();
      if (normalized) return normalized;
    }
    return '';
  }

  function parseBoundedInt(value, fallback, min = 1, max = 1000) {
    const parsed = Number.parseInt(String(value || ''), 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, parsed));
  }

  function authResult(c) {
    const { authService } = getServices(c);
    return authService.checkAuthentication(c.req.raw);
  }

  function isTruthy(value) {
    if (value == null) return false;
    const normalized = String(value).trim().toLowerCase();
    return ['1', 'true', 'yes', 'on'].includes(normalized);
  }

  function requireAuth(c) {
    const result = authResult(c);
    if (!result.authenticated) {
      return jsonError(c, 401, 'UNAUTHORIZED', 'Authentication required.', result.reason || 'Unauthorized');
    }
    c.set('auth', result);
    return null;
  }

  function normalizeUploadError(c, error, fallbackStatus = 500) {
    const payload = toStorageErrorPayload(error, error?.status || fallbackStatus);
    const detail = payload.detail || payload.message || 'Upload failed.';
    const message = payload.message || 'Upload failed.';
    const code = payload.code || 'UPLOAD_FAILED';
    const retriable = payload.retriable === true;

    if (prefersV2Envelope(c)) {
      return {
        success: false,
        error: {
          code,
          message,
          detail,
          retriable,
        },
      };
    }

    return {
      success: false,
      error: message,
      errorCode: code,
      errorDetail: detail,
      retriable,
    };
  }

  function getPublicOrigin(c) {
    const configured = String(container.config.publicBaseUrl || '').trim().replace(/\/+$/, '');
    if (configured) return configured;
    const url = new URL(c.req.url);
    return `${url.protocol}//${url.host}`;
  }

  function toAbsoluteUrl(c, path) {
    return new URL(path, `${getPublicOrigin(c)}/`).toString();
  }

  function buildFileProxyHeaders(result, upstreamHeaders) {
    const headers = new Headers(upstreamHeaders);
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Range, Content-Type, Accept, Origin');
    headers.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges, Content-Disposition');
    headers.set('Cache-Control', 'no-store, max-age=0');

    if (!headers.get('content-type') && result.file.mime_type) {
      headers.set('Content-Type', result.file.mime_type);
    }
    if (!headers.get('content-disposition')) {
      const safeName = encodeURIComponent(result.file.file_name || result.file.id);
      headers.set('Content-Disposition', `inline; filename="${safeName}"; filename*=UTF-8''${safeName}`);
    }

    return headers;
  }

  function signedTelegramHeaders(upstream, parsed) {
    const headers = new Headers(upstream.headers);
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    headers.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges, Content-Disposition');
    headers.set('Cache-Control', 'no-store, max-age=0');
    if (!headers.get('content-type') && parsed.mimeType) headers.set('Content-Type', parsed.mimeType);
    if (!headers.get('content-disposition')) {
      const safeName = encodeURIComponent(parsed.fileName || `${parsed.fileId}.${parsed.fileExtension}`);
      headers.set('Content-Disposition', `inline; filename="${safeName}"; filename*=UTF-8''${safeName}`);
    }
    return headers;
  }

  async function handleSignedTelegramFile(options) {
    const { id, range, storageRepo, context: c, headOnly = false } = options;
    const env = { ...process.env, FILE_URL_SECRET: container.config.configEncryptionKey };
    const parsed = parseSignedTelegramFileId(id, env);
    if (!parsed?.fileId) {
      return c.text('Invalid or expired signed file link.', 403);
    }

    // Resolve Telegram storage config
    const telegramConfigs = storageRepo.findEnabledByType('telegram');
    let tgConfig = telegramConfigs[0]?.config;
    if (!tgConfig?.botToken) {
      const bootstrap = container.config.bootstrapDefaultStorage?.telegram;
      if (bootstrap?.botToken) tgConfig = bootstrap;
    }
    if (!tgConfig?.botToken) {
      return c.text('Telegram storage not configured.', 500);
    }

    const { TelegramStorageAdapter } = require('../lib/storage/adapters/telegram');
    const adapter = new TelegramStorageAdapter({
      botToken: tgConfig.botToken,
      chatId: tgConfig.chatId,
      apiBase: tgConfig.apiBase || container.config.telegramApiBase,
    });

    const upstream = await adapter.download({
      storageKey: parsed.fileId,
      metadata: { telegramFileId: parsed.fileId },
      range,
    });

    if (!upstream) {
      return c.text('File not found on Telegram.', 404);
    }

    const headers = signedTelegramHeaders(upstream, parsed);

    if (headOnly) {
      return new Response(null, { status: upstream.status, statusText: upstream.statusText, headers });
    }

    return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers });
  }

  function parseShareExpiry(value, fallbackSeconds = 7 * 24 * 60 * 60) {
    const seconds = parseBoundedInt(value, fallbackSeconds, 60, 365 * 24 * 60 * 60);
    return Date.now() + (seconds * 1000);
  }

  function formatStatusDetail(detail) {
    if (detail == null) return '';
    if (typeof detail === 'string') return detail;
    if (detail instanceof Error) return detail.message || String(detail);
    if (typeof detail === 'object') {
      if (typeof detail.description === 'string' && detail.description) return detail.description;
      if (typeof detail.message === 'string' && detail.message) return detail.message;
      if (typeof detail.error === 'string' && detail.error) return detail.error;
      try {
        return JSON.stringify(detail);
      } catch {
        return String(detail);
      }
    }
    return String(detail);
  }

  function uploadSuccessResponse(c, result) {
    const item = {
      src: result.src,
      storageType: result.storage.type,
      storageId: result.storage.id,
      fileId: result.file?.id,
      folderPath: result.file?.metadata?.folderPath || '',
    };

    if (prefersV2Envelope(c)) {
      return c.json({
        success: true,
        data: {
          ...item,
          items: [item],
        },
        traceId: getTraceId(c),
      });
    }

    return c.json([item]);
  }

  return {
    getServices,
    getTraceId,
    prefersV2Envelope,
    jsonError,
    methodNotAllowed,
    asString,
    firstNonEmpty,
    parseBoundedInt,
    authResult,
    isTruthy,
    requireAuth,
    normalizeUploadError,
    getPublicOrigin,
    toAbsoluteUrl,
    buildFileProxyHeaders,
    handleSignedTelegramFile,
    parseShareExpiry,
    formatStatusDetail,
    getUploadLimits: uploadCapabilities.getUploadLimits,
    validateUploadCapability: uploadCapabilities.validateUploadCapability,
    uploadSuccessResponse,
  };
}

module.exports = {
  createRouteHelpers,
};
