const {
  contract, driveError, driveResponse, pageRequest, requireDriveAuth,
} = require('./common');
const { DriveQueryRepository } = require('../../lib/repos/drive-query-repo');

function queryRepository(context, helpers) {
  return new DriveQueryRepository(helpers.getServices(context).db);
}

function visibilityFilter(value) {
  const visibility = String(value || 'all').toLowerCase();
  if (!['all', 'public', 'private'].includes(visibility)) {
    throw Object.assign(new Error('FILE_VISIBILITY_INVALID'), {
      code: 'FILE_VISIBILITY_INVALID', status: 400,
    });
  }
  return visibility;
}

function explorerOptions(context) {
  const page = pageRequest(context);
  return Object.freeze({
    folderPath: contract.normalizeDrivePath(context.req.query('path') || ''),
    limit: page.limit,
    cursor: page.cursor,
    includeStats: helpersTruthy(context.req.query('includeStats')),
    filters: Object.freeze({
      storageType: context.req.query('storage') || 'all',
      search: context.req.query('search') || '',
      listType: context.req.query('listType') || 'all',
      visibility: visibilityFilter(context.req.query('visibility')),
    }),
  });
}

function helpersTruthy(value) {
  return ['1', 'true', 'yes'].includes(String(value || '').toLowerCase());
}

function registerTree(app, helpers) {
  app.get('/api/drive/tree', (context) => {
    const unauthorized = requireDriveAuth(context, helpers);
    if (unauthorized) return unauthorized;
    try {
      const page = pageRequest(context);
      const result = queryRepository(context, helpers).listTreePage({
        storageType: context.req.query('storage') || 'all', ...page,
      });
      return context.json({
        ...contract.driveEnvelope('nodes', result.nodes),
        cursor: result.cursor,
        list_complete: result.list_complete,
      });
    } catch (error) {
      return driveError(context, helpers, error);
    }
  });
}

function registerExplorer(app, helpers) {
  app.get('/api/drive/explorer', (context) => {
    const unauthorized = requireDriveAuth(context, helpers);
    if (unauthorized) return unauthorized;
    try {
      const payload = queryRepository(context, helpers).listExplorer(explorerOptions(context));
      return driveResponse(context, 'explorer', payload);
    } catch (error) {
      return driveError(context, helpers, error);
    }
  });
}

function registerDriveListRoutes(app, helpers) {
  registerTree(app, helpers);
  registerExplorer(app, helpers);
}

module.exports = { registerDriveListRoutes };
