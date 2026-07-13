const {
  contract, driveError, driveResponse, requireDriveAuth,
} = require('./common');

async function input(context) {
  return context.req.json().catch(() => ({}));
}

function idsFrom(body) {
  return [...new Set((Array.isArray(body.ids) ? body.ids : [])
    .map((id) => String(id || '').trim()).filter(Boolean))];
}

function registerMove(app, helpers) {
  app.post('/api/drive/files/move', async (context) => {
    const unauthorized = requireDriveAuth(context, helpers);
    if (unauthorized) return unauthorized;
    try {
      const body = await input(context);
      const ids = idsFrom(body);
      if (!ids.length) throw Object.assign(new Error('IDS_REQUIRED'), { code: 'IDS_REQUIRED', status: 400 });
      const target = contract.normalizeDrivePath(body.targetFolderPath || '');
      return driveResponse(context, 'mutation', helpers.getServices(context).fileRepo.moveFiles(ids, target));
    } catch (error) {
      return driveError(context, helpers, error);
    }
  });
}

function registerRename(app, helpers) {
  app.post('/api/drive/files/rename', async (context) => {
    const unauthorized = requireDriveAuth(context, helpers);
    if (unauthorized) return unauthorized;
    try {
      const body = await input(context);
      const id = String(body.id || '').trim();
      const fileName = String(body.fileName || '').trim();
      if (!id || !fileName) throw Object.assign(new Error('FILE_RENAME_PARAMS_REQUIRED'), {
        code: 'FILE_RENAME_PARAMS_REQUIRED', status: 400,
      });
      const updated = helpers.getServices(context).fileRepo.updateMetadata(id, { fileName });
      if (!updated) return driveError(context, helpers, null, { status: 404, code: 'FILE_NOT_FOUND' });
      return driveResponse(context, 'file', { id: updated.id, fileName: updated.file_name });
    } catch (error) {
      return driveError(context, helpers, error);
    }
  });
}

async function deleteBatch(services, ids) {
  let deleted = 0;
  const notFound = [];
  const failed = [];
  for (const id of ids) {
    try {
      const result = await services.uploadService.deleteFile(id);
      if (result.deleted) deleted += 1;
      else notFound.push(id);
    } catch {
      failed.push(id);
    }
  }
  return Object.freeze({ requested: ids.length, deleted, notFound, failed });
}

function registerDelete(app, helpers) {
  app.post('/api/drive/files/delete-batch', async (context) => {
    const unauthorized = requireDriveAuth(context, helpers);
    if (unauthorized) return unauthorized;
    const ids = idsFrom(await input(context));
    if (!ids.length) return driveError(context, helpers, null, { status: 400, code: 'IDS_REQUIRED' });
    return driveResponse(context, 'mutation', await deleteBatch(helpers.getServices(context), ids));
  });
}

function registerDriveFileRoutes(app, helpers) {
  registerMove(app, helpers);
  registerRename(app, helpers);
  registerDelete(app, helpers);
}

module.exports = { registerDriveFileRoutes };
