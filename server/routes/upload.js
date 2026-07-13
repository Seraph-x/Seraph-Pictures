const { registerChunkUploadRoutes } = require('./upload-chunks');
const { registerDirectUploadRoute } = require('./upload-direct');
const { registerRemoteUploadRoute } = require('./upload-remote');

function registerUploadRoutes(app, container, helpers) {
  registerDirectUploadRoute(app, container, helpers);
  registerRemoteUploadRoute(app, container, helpers);
  registerChunkUploadRoutes(app, container, helpers);
}

module.exports = { registerUploadRoutes };
