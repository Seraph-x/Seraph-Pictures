function registerVisibilityRoutes(app, container, helpers) {
  const { getServices, jsonError, requireAuth } = helpers;
  app.put('/api/manage/files/:id/visibility', async (context) => {
    const unauthorized = requireAuth(context);
    if (unauthorized) return unauthorized;
    const body = await context.req.json().catch(() => ({}));
    try {
      const file = getServices(context).fileRepo.updateVisibility(
        context.req.param('id'),
        {
          visibility: body.visibility,
          actor: 'admin',
          ownershipTransferred: body.ownershipTransferred === true,
        },
      );
      if (!file) {
        return jsonError(
          context, 404, 'FILE_NOT_FOUND', 'File not found.', 'Unknown file id.',
        );
      }
      return context.json({ success: true, file });
    } catch (error) {
      const conflict = error?.code === 'FILE_OWNERSHIP_TRANSFER_REQUIRED';
      return jsonError(
        context,
        conflict ? 409 : 400,
        error?.code || 'FILE_VISIBILITY_INVALID',
        'Visibility update failed.',
        error.message,
      );
    }
  });
}

module.exports = { registerVisibilityRoutes };
