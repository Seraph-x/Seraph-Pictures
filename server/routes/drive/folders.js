const {
  contract, driveError, driveResponse, requireDriveAuth,
} = require('./common');

async function body(context) {
  return context.req.json().catch(() => ({}));
}

function registerCreate(app, helpers) {
  app.post('/api/drive/folders', async (context) => {
    const unauthorized = requireDriveAuth(context, helpers);
    if (unauthorized) return unauthorized;
    try {
      const input = await body(context);
      const path = contract.normalizeDrivePath(input.path);
      if (!path) throw Object.assign(new Error('DRIVE_PATH_REQUIRED'), {
        code: 'DRIVE_PATH_REQUIRED', status: 400,
      });
      const folder = helpers.getServices(context).fileRepo.createFolder(path);
      return driveResponse(context, 'folder', folder);
    } catch (error) {
      return driveError(context, helpers, error);
    }
  });
}

function registerMove(app, helpers) {
  app.post('/api/drive/folders/move', async (context) => {
    const unauthorized = requireDriveAuth(context, helpers);
    if (unauthorized) return unauthorized;
    try {
      const input = await body(context);
      const sourcePath = contract.normalizeDrivePath(input.sourcePath);
      const targetPath = contract.normalizeDrivePath(input.targetPath);
      if (!sourcePath || !targetPath) throw Object.assign(new Error('MOVE_PATHS_REQUIRED'), {
        code: 'MOVE_PATHS_REQUIRED', status: 400,
      });
      const result = helpers.getServices(context).fileRepo.moveFolder(sourcePath, targetPath);
      return driveResponse(context, 'mutation', result);
    } catch (error) {
      return driveError(context, helpers, error);
    }
  });
}

async function deleteFilesInFolder(services, path) {
  let deletedFiles = 0;
  for (const id of services.fileRepo.listFileIdsByFolderPrefix(path)) {
    const result = await services.uploadService.deleteFile(id);
    if (result.deleted) deletedFiles += 1;
  }
  return deletedFiles;
}

function registerDelete(app, helpers) {
  app.delete('/api/drive/folders', async (context) => {
    const unauthorized = requireDriveAuth(context, helpers);
    if (unauthorized) return unauthorized;
    try {
      const path = contract.normalizeDrivePath(context.req.query('path'));
      if (!path) throw Object.assign(new Error('DRIVE_PATH_REQUIRED'), {
        code: 'DRIVE_PATH_REQUIRED', status: 400,
      });
      const recursive = helpers.isTruthy(context.req.query('recursive'));
      const services = helpers.getServices(context);
      const deletedFiles = recursive ? await deleteFilesInFolder(services, path) : 0;
      const result = services.fileRepo.deleteFolder(path, { recursive });
      return driveResponse(context, 'mutation', { ...result, recursive, deletedFiles });
    } catch (error) {
      const conflict = /not empty/i.test(error?.message || '');
      return driveError(context, helpers, error, conflict ? {
        status: 409, code: 'DRIVE_FOLDER_NOT_EMPTY',
      } : {});
    }
  });
}

function registerDriveFolderRoutes(app, helpers) {
  registerCreate(app, helpers);
  registerMove(app, helpers);
  registerDelete(app, helpers);
}

module.exports = { registerDriveFolderRoutes };
