function record(context, helpers) {
  const id = decodeURIComponent(context.req.param('id'));
  return Object.freeze({ id, repo: helpers.getServices(context).fileRepo });
}

function missing(context, helpers, id) {
  return helpers.jsonError(
    context, 404, 'FILE_NOT_FOUND', 'File not found.', `File "${id}" does not exist.`,
  );
}

function registerToggle(app, helpers) {
  app.get('/api/manage/toggleLike/:id', (context) => helpers.methodNotAllowed(context, 'POST'));
  app.post('/api/manage/toggleLike/:id', (context) => {
    const unauthorized = helpers.requireAuth(context);
    if (unauthorized) return unauthorized;
    const { id, repo } = record(context, helpers);
    const file = repo.getById(id);
    if (!file) return missing(context, helpers, id);
    const updated = repo.updateMetadata(id, { liked: !Boolean(file.liked) });
    return context.json({ success: true, liked: Boolean(updated.liked) });
  });
}

function registerRename(app, helpers) {
  app.get('/api/manage/editName/:id', (context) => helpers.methodNotAllowed(context, 'POST'));
  app.post('/api/manage/editName/:id', async (context) => {
    const unauthorized = helpers.requireAuth(context);
    if (unauthorized) return unauthorized;
    const { id, repo } = record(context, helpers);
    const body = await context.req.json().catch(() => ({}));
    const fileName = String(body.newName || '').trim();
    if (!fileName) return helpers.jsonError(
      context, 400, 'NEW_NAME_REQUIRED', 'newName is required.', 'Provide newName.',
    );
    const updated = repo.updateMetadata(id, { fileName });
    return updated
      ? context.json({ success: true, fileName: updated.file_name, key: updated.id })
      : missing(context, helpers, id);
  });
}

function registerListType(app, helpers, route, listType) {
  app.get(`/api/manage/${route}/:id`, (context) => helpers.methodNotAllowed(context, 'POST'));
  app.post(`/api/manage/${route}/:id`, (context) => {
    const unauthorized = helpers.requireAuth(context);
    if (unauthorized) return unauthorized;
    const { id, repo } = record(context, helpers);
    const updated = repo.updateMetadata(id, { listType });
    return updated
      ? context.json({ success: true, listType, key: updated.id })
      : missing(context, helpers, id);
  });
}

function registerDelete(app, helpers) {
  app.get('/api/manage/delete/:id', (context) => helpers.methodNotAllowed(context, 'DELETE'));
  app.delete('/api/manage/delete/:id', async (context) => {
    const unauthorized = helpers.requireAuth(context);
    if (unauthorized) return unauthorized;
    const id = decodeURIComponent(context.req.param('id'));
    const result = await helpers.getServices(context).uploadService.deleteFile(id);
    return result.deleted
      ? context.json({ success: true, message: 'File deleted.', fileId: id })
      : missing(context, helpers, id);
  });
}

function registerMoveFolder(app, helpers) {
  app.post('/api/manage/files/move-folder', async (context) => {
    const unauthorized = helpers.requireAuth(context);
    if (unauthorized) return unauthorized;
    const body = await context.req.json().catch(() => ({}));
    const ids = Array.isArray(body.ids)
      ? body.ids.map((id) => String(id || '').trim()).filter(Boolean)
      : [];
    if (!ids.length) return helpers.jsonError(
      context, 400, 'IDS_REQUIRED', 'ids is required.', 'Provide at least one file id.',
    );
    const target = body.targetFolderPath || body.folderPath || body.path || '';
    const result = helpers.getServices(context).fileRepo.moveFiles(ids, target);
    return context.json({ success: true, ...result });
  });
}

function registerLegacyManageFileRoutes(app, helpers) {
  registerToggle(app, helpers);
  registerRename(app, helpers);
  registerListType(app, helpers, 'block', 'Block');
  registerListType(app, helpers, 'white', 'White');
  registerDelete(app, helpers);
  registerMoveFolder(app, helpers);
}

module.exports = { registerLegacyManageFileRoutes };
