const contract = require('../../../shared/storage/contracts.cjs');

function storageResponse(context, kind, payload) {
  return context.json(contract.storageEnvelope(kind, payload));
}

function storageError(context, helpers, error, options = {}) {
  const status = error?.status || options.status || 500;
  const code = error?.code || options.code || 'STORAGE_OPERATION_FAILED';
  return helpers.jsonError(
    context,
    status,
    code,
    options.message || 'Storage operation failed.',
    error?.message || code,
  );
}

function requireStorageAuth(context, helpers) {
  return helpers.requireAuth(context);
}

module.exports = { storageResponse, storageError, requireStorageAuth };
