const contract = require('../../../shared/storage/contracts.cjs');

function storageResponse(context, kind, payload) {
  return context.json(contract.storageEnvelope(kind, payload));
}

function storageError(context, input) {
  const { helpers, error, options = {} } = input;
  const details = contract.storageErrorDetails({
    code: error?.code || options.code,
    status: error?.status || options.status,
  });
  return helpers.jsonError(
    context,
    details.status,
    details.code,
    options.message || 'Storage operation failed.',
    error?.message || details.code,
  );
}

function requireStorageAuth(context, helpers) {
  return helpers.requireAuth(context);
}

module.exports = { storageResponse, storageError, requireStorageAuth };
