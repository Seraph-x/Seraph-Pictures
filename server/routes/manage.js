const { registerLegacyManageListRoutes } = require('./manage/list');
const { registerLegacyManageFolderRoutes } = require('./manage/folders');
const { registerLegacyManageFileRoutes } = require('./manage/files');

function registerManageRoutes(app, container, helpers) {
  registerLegacyManageListRoutes(app, helpers);
  registerLegacyManageFolderRoutes(app, helpers);
  registerLegacyManageFileRoutes(app, helpers);
}

module.exports = { registerManageRoutes };
