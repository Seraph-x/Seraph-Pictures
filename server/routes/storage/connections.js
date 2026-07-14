const { toStorageErrorPayload } = require('../../lib/utils/storage-error');
const {
  requireStorageAuth, storageError, storageResponse,
} = require('./common');

function failedResult(error) {
  const payload = toStorageErrorPayload(error);
  return Object.freeze({ connected: false, errorModel: payload, detail: payload.detail });
}

async function testAdapter(context, helpers, adapter) {
  try {
    const result = { ...await adapter.testConnection() };
    if (!result.connected) {
      result.detail = helpers.formatStatusDetail(result.detail || result.raw || 'Connection failed');
      result.errorModel = toStorageErrorPayload(result.detail, result.status);
    }
    return storageResponse(context, 'result', result);
  } catch (error) {
    if (error?.status === 400) return storageError(context, helpers, error);
    return storageResponse(context, 'result', failedResult(error));
  }
}

function registerStoredTest(app, helpers) {
  app.post('/api/storage/:id/test', async (context) => {
    const unauthorized = requireStorageAuth(context, helpers);
    if (unauthorized) return unauthorized;
    const { storageRepo, storageFactory } = helpers.getServices(context);
    const item = storageRepo.getById(context.req.param('id'), true);
    if (!item) return storageError(context, helpers, null, {
      status: 404, code: 'STORAGE_PROFILE_NOT_FOUND', message: 'Storage profile not found.',
    });
    return testAdapter(context, helpers, storageFactory.createAdapter(item));
  });
}

function registerDraftTest(app, helpers) {
  app.post('/api/storage/test', async (context) => {
    const unauthorized = requireStorageAuth(context, helpers);
    if (unauthorized) return unauthorized;
    try {
      const body = await context.req.json();
      const factory = helpers.getServices(context).storageFactory;
      return testAdapter(context, helpers, factory.createTemporaryAdapter(body.type, body.config || {}));
    } catch (error) {
      return error?.status === 400
        ? storageError(context, helpers, error)
        : storageResponse(context, 'result', failedResult(error));
    }
  });
}

function registerStorageConnectionRoutes(app, helpers) {
  registerStoredTest(app, helpers);
  registerDraftTest(app, helpers);
}

module.exports = { registerStorageConnectionRoutes };
