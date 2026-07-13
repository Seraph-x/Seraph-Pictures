const { registerStorageCrudRoutes } = require('./storage/crud');
const { registerStorageConnectionRoutes } = require('./storage/connections');
const { registerStorageBootstrapRoute } = require('./storage/bootstrap');

function registerStorageRoutes(app, container, helpers) {
  registerStorageCrudRoutes(app, helpers);
  registerStorageConnectionRoutes(app, helpers);
  registerStorageBootstrapRoute(app, container, helpers);
}

module.exports = { registerStorageRoutes };
