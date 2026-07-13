const { initDatabase, cleanupExpiredState } = require('../db');
const { loadConfig } = require('./config');
const { loadShareConfig } = require('./config/share-config');
const { AuthService } = require('./utils/auth');
const { GuestService } = require('./utils/guest');
const { StorageFactory } = require('./storage/factory');
const { StorageConfigRepository } = require('./repos/storage-config-repo');
const { VisibilityFileRepository } = require('./repos/visibility-file-repo');
const { ShareRepository } = require('./repos/share-repo');
const { UploadService } = require('./services/upload-service');
const { ChunkUploadService } = require('./services/chunk-service');
const { LoginRateLimitService } = require('./services/login-rate-limit-service');
const { ShareService } = require('./services/share-service');
const { createSettingsStore } = require('./settings/factory');

function createContainer(env = process.env) {
  const config = loadConfig(env);
  const shareConfig = loadShareConfig({ env, nodeEnv: config.nodeEnv });
  const db = initDatabase(config.dbPath);

  const storageRepo = new StorageConfigRepository(db, config);
  const fileRepo = new VisibilityFileRepository(db);
  const shareRepo = new ShareRepository(db);
  const storageFactory = new StorageFactory();
  const settingsStore = createSettingsStore({ db, config });

  storageRepo.ensureBootstrapStorage();
  cleanupExpiredState(db);

  const uploadService = new UploadService({
    storageRepo,
    fileRepo,
    storageFactory,
  });

  const chunkService = new ChunkUploadService({
    db,
    config,
    uploadService,
  });

  const authService = new AuthService(db, config);
  const guestService = new GuestService(db, config);
  const loginRateLimitService = new LoginRateLimitService({ db });
  const shareService = new ShareService({
    repository: shareRepo,
    currentSecret: shareConfig.currentSecret,
    previousSecret: shareConfig.previousSecret,
    previousValidUntil: shareConfig.previousValidUntil,
  });

  return {
    config,
    db,
    authService,
    guestService,
    loginRateLimitService,
    storageRepo,
    fileRepo,
    shareRepo,
    shareService,
    storageFactory,
    settingsStore,
    uploadService,
    chunkService,
  };
}

module.exports = {
  createContainer,
};
