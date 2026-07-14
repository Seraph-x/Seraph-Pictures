const { initDatabase, cleanupExpiredState } = require('../db');
const { loadConfig } = require('./config');
const { loadShareConfig } = require('./config/share-config');
const { AuthService } = require('./utils/auth');
const { GuestService } = require('./utils/guest');
const { StorageFactory } = require('./storage/factory');
const { StorageConfigRepository } = require('./repos/storage-config-repo');
const { GuestStorageRepository } = require('./repos/guest-storage-repo');
const { GuestQuotaRepository } = require('./repos/guest-quota-repo');
const { GuestQuotaService } = require('../../shared/security/guest-quota-service.cjs');
const { randomId } = require('./utils/crypto');
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
  const guestStorageRepo = new GuestStorageRepository({
    storageRepo,
    bootstrap: config.bootstrapDefaultStorage.telegramGuest,
  });
  const fileRepo = new VisibilityFileRepository(db);
  const shareRepo = new ShareRepository(db);
  const storageFactory = new StorageFactory();
  const settingsStore = createSettingsStore({ db, config });

  storageRepo.ensureBootstrapStorage();
  guestStorageRepo.ensureBootstrap();
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
    storageRepo,
  });

  const authService = new AuthService(db, config);
  const guestQuota = new GuestQuotaService({
    repository: new GuestQuotaRepository(db),
    clock: { now: () => Date.now() },
    ids: { create: () => randomId('gq') },
  });
  const guestService = new GuestService({
    quota: guestQuota,
    storageRepo: guestStorageRepo,
    config,
    clock: { now: () => Date.now() },
  });
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
    guestStorageRepo,
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
