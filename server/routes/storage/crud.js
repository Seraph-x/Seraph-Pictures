const {
  requireStorageAuth, storageError, storageResponse,
} = require('./common');
const contract = require('../../../shared/storage/contracts.cjs');

function validateInput(body, current = {}) {
  return contract.normalizeStorageItem({
    id: current.id || 'pending',
    name: body.name ?? current.name,
    type: body.type || current.type,
    config: body.config ?? current.config ?? {},
    metadata: body.metadata ?? current.metadata ?? {},
    enabled: body.enabled ?? current.enabled ?? true,
    isDefault: body.isDefault ?? current.isDefault ?? false,
  });
}

function createInput(body) {
  const valid = validateInput(body);
  return Object.freeze({
    name: valid.name, type: valid.type, config: body.config || {},
    enabled: body.enabled !== false, isDefault: Boolean(body.isDefault),
    metadata: body.metadata || {},
  });
}

function updateInput(body, current) {
  const valid = validateInput(body, current);
  const patch = { name: valid.name, type: valid.type };
  for (const field of ['config', 'enabled', 'isDefault', 'metadata']) {
    if (body[field] !== undefined) patch[field] = body[field];
  }
  return Object.freeze(patch);
}

function registerReadCreate(app, helpers) {
  app.get('/api/storage/list', (context) => {
    const unauthorized = requireStorageAuth(context, helpers);
    if (unauthorized) return unauthorized;
    return storageResponse(context, 'items', helpers.getServices(context).storageRepo.list(false));
  });
  app.post('/api/storage', async (context) => {
    const unauthorized = requireStorageAuth(context, helpers);
    if (unauthorized) return unauthorized;
    try {
      const repo = helpers.getServices(context).storageRepo;
      return storageResponse(context, 'item', repo.create(createInput(await context.req.json())));
    } catch (error) {
      return storageError(context, helpers, error);
    }
  });
}

function registerUpdate(app, helpers) {
  app.put('/api/storage/:id', async (context) => {
    const unauthorized = requireStorageAuth(context, helpers);
    if (unauthorized) return unauthorized;
    try {
      const repo = helpers.getServices(context).storageRepo;
      const id = context.req.param('id');
      const current = repo.getById(id, true);
      if (!current) return storageError(context, helpers, null, {
        status: 404, code: 'STORAGE_PROFILE_NOT_FOUND', message: 'Storage profile not found.',
      });
      const item = repo.update(id, updateInput(await context.req.json(), current));
      if (!item) return storageError(context, helpers, null, {
        status: 404, code: 'STORAGE_PROFILE_NOT_FOUND', message: 'Storage profile not found.',
      });
      return storageResponse(context, 'item', item);
    } catch (error) {
      return storageError(context, helpers, error);
    }
  });
}

function registerDeleteDefault(app, helpers) {
  app.delete('/api/storage/:id', (context) => {
    const unauthorized = requireStorageAuth(context, helpers);
    if (unauthorized) return unauthorized;
    try {
      const deleted = helpers.getServices(context).storageRepo.delete(context.req.param('id'));
      return deleted
        ? storageResponse(context, 'success')
        : storageError(context, helpers, null, { status: 404, code: 'STORAGE_PROFILE_NOT_FOUND' });
    } catch (error) {
      return storageError(context, helpers, error);
    }
  });
  app.post('/api/storage/default/:id', (context) => {
    const unauthorized = requireStorageAuth(context, helpers);
    if (unauthorized) return unauthorized;
    try {
      const item = helpers.getServices(context).storageRepo.setDefault(context.req.param('id'));
      return item
        ? storageResponse(context, 'item', item)
        : storageError(context, helpers, null, { status: 404, code: 'STORAGE_PROFILE_NOT_FOUND' });
    } catch (error) {
      return storageError(context, helpers, error);
    }
  });
}

function registerStorageCrudRoutes(app, helpers) {
  registerReadCreate(app, helpers);
  registerUpdate(app, helpers);
  registerDeleteDefault(app, helpers);
}

module.exports = { registerStorageCrudRoutes };
