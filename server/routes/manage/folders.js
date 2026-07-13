const { normalizeFolderPath } = require('../../lib/repos/file-repo');

function folderError(context, helpers, code, message) {
  return helpers.jsonError(context, 400, code, message, message);
}

function registerReadCreate(app, helpers) {
  app.get('/api/manage/folders', (context) => {
    const unauthorized = helpers.requireAuth(context);
    if (unauthorized) return unauthorized;
    const storageType = context.req.query('storage') || 'all';
    const folders = helpers.getServices(context).fileRepo.listFolderTree({ storageType });
    return context.json({ success: true, folders });
  });
  app.post('/api/manage/folders', async (context) => {
    const unauthorized = helpers.requireAuth(context);
    if (unauthorized) return unauthorized;
    const body = await context.req.json().catch(() => ({}));
    const path = normalizeFolderPath(body.path || body.folderPath);
    if (!path) return folderError(context, helpers, 'PATH_REQUIRED', 'path is required.');
    return context.json({ success: true, folder: helpers.getServices(context).fileRepo.createFolder(path) });
  });
}

function registerMove(app, helpers) {
  app.put('/api/manage/folders', async (context) => {
    const unauthorized = helpers.requireAuth(context);
    if (unauthorized) return unauthorized;
    const body = await context.req.json().catch(() => ({}));
    const source = normalizeFolderPath(body.sourcePath || body.path);
    const target = normalizeFolderPath(body.targetPath || body.newPath);
    if (!source || !target) {
      return folderError(context, helpers, 'MOVE_PATHS_REQUIRED', 'sourcePath and targetPath are required.');
    }
    const result = helpers.getServices(context).fileRepo.moveFolder(source, target);
    return context.json({ success: true, ...result });
  });
}

function registerDelete(app, helpers) {
  app.delete('/api/manage/folders', (context) => {
    const unauthorized = helpers.requireAuth(context);
    if (unauthorized) return unauthorized;
    const path = normalizeFolderPath(context.req.query('path'));
    if (!path) return folderError(context, helpers, 'PATH_REQUIRED', 'path is required.');
    const recursive = helpers.isTruthy(context.req.query('recursive'));
    const repo = helpers.getServices(context).fileRepo;
    let movedFiles = 0;
    if (recursive) {
      const result = repo.moveFiles(repo.listFileIdsByFolderPrefix(path), '');
      movedFiles = Number(result.moved || 0);
    }
    return context.json({
      success: true, recursive, movedFiles, ...repo.deleteFolder(path, { recursive }),
    });
  });
}

function registerLegacyManageFolderRoutes(app, helpers) {
  registerReadCreate(app, helpers);
  registerMove(app, helpers);
  registerDelete(app, helpers);
}

module.exports = { registerLegacyManageFolderRoutes };
