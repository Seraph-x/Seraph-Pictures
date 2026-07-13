const contract = require('../../../shared/storage/contracts.cjs');
const pagination = require('../../../shared/storage/pagination.cjs');

function driveResponse(context, kind, payload) {
  return context.json(contract.driveEnvelope(kind, payload));
}

function driveError(context, helpers, error, options = {}) {
  const status = error?.status || options.status || 500;
  const code = error?.code || options.code || 'DRIVE_OPERATION_FAILED';
  return helpers.jsonError(
    context, status, code, options.message || 'Drive operation failed.', error?.message || code,
  );
}

function requireDriveAuth(context, helpers) {
  return helpers.requireAuth(context);
}

function pageRequest(context) {
  return pagination.normalizePageRequest({
    limit: context.req.query('limit'), cursor: context.req.query('cursor'),
  });
}

module.exports = {
  contract, driveResponse, driveError, requireDriveAuth, pageRequest,
};
