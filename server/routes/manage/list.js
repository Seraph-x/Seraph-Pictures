const { normalizeFolderPath } = require('../../lib/repos/file-repo');

function listOptions(context, helpers) {
  const limit = helpers.parseBoundedInt(
    helpers.firstNonEmpty(context.req.query('limit'), context.req.query('pageSize')),
    100, 1, 1000,
  );
  let cursor = helpers.firstNonEmpty(context.req.query('cursor'), context.req.query('offset'));
  if (!cursor) {
    const page = helpers.parseBoundedInt(context.req.query('page'), 1, 1, Number.MAX_SAFE_INTEGER);
    cursor = page > 1 ? String((page - 1) * limit) : null;
  }
  const hasFolder = context.req.query('folderPath') != null || context.req.query('path') != null;
  return Object.freeze({
    limit,
    cursor,
    includeStats: helpers.isTruthy(context.req.query('includeStats') || context.req.query('stats')),
    filters: Object.freeze({
      storageType: context.req.query('storage') || 'all',
      search: context.req.query('search') || '',
      listType: context.req.query('listType') || context.req.query('list_type') || 'all',
      folderPath: hasFolder
        ? normalizeFolderPath(context.req.query('folderPath') || context.req.query('path'))
        : undefined,
    }),
  });
}

function registerLegacyManageListRoutes(app, helpers) {
  app.get('/api/manage/list', (context) => {
    const unauthorized = helpers.requireAuth(context);
    if (unauthorized) return unauthorized;
    return context.json(helpers.getServices(context).fileRepo.list(listOptions(context, helpers)));
  });
}

module.exports = { registerLegacyManageListRoutes };
