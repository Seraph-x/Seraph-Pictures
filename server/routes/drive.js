const { registerDriveListRoutes } = require('./drive/list');
const { registerDriveFolderRoutes } = require('./drive/folders');
const { registerDriveFileRoutes } = require('./drive/files');

function registerDriveRoutes(app, helpers) {
  registerDriveListRoutes(app, helpers);
  registerDriveFolderRoutes(app, helpers);
  registerDriveFileRoutes(app, helpers);
}

module.exports = { registerDriveRoutes };
