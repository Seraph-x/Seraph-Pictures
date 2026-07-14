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
const { StorageLifecycleService } = require('./services/storage-lifecycle-service');
const { createSettingsStore } = require('./settings/factory');

function createRepositories(db, config) {
  const storageRepo = new StorageConfigRepository(db, config);
  const guestStorageRepo = new GuestStorageRepository({
    storageRepo,
    bootstrap: config.bootstrapDefaultStorage.telegramGuest,
  });
  return Object.freeze({
    storageRepo,
    guestStorageRepo,
    fileRepo: new VisibilityFileRepository(db),
    shareRepo: new ShareRepository(db),
  });
}

function initializePersistence(db, repositories) {
  repositories.storageRepo.ensureBootstrapStorage();
  repositories.guestStorageRepo.ensureBootstrap();
  cleanupExpiredState(db);
}

function createStorageServices({ db, config, repositories }) {
  const { storageRepo, fileRepo } = repositories;
  const storageFactory = new StorageFactory();
  const storageLifecycle = new StorageLifecycleService({ storageRepo, fileRepo, storageFactory });
  const uploadService = new UploadService({ storageRepo, fileRepo, storageFactory, storageLifecycle });
  const chunkService = new ChunkUploadService({
    db, config, uploadService, storageRepo,
  });
  return Object.freeze({ storageFactory, uploadService, chunkService });
}

function createIdentityServices({ db, config, shareConfig, repositories }) {
  const authService = new AuthService(db, config);
  const guestQuota = new GuestQuotaService({
    repository: new GuestQuotaRepository(db),
    clock: { now: () => Date.now() },
    ids: { create: () => randomId('gq') },
  });
  const guestService = new GuestService({
    quota: guestQuota,
    storageRepo: repositories.guestStorageRepo,
    config,
    clock: { now: () => Date.now() },
  });
  const loginRateLimitService = new LoginRateLimitService({ db });
  const shareService = new ShareService({
    repository: repositories.shareRepo,
    currentSecret: shareConfig.currentSecret,
    previousSecret: shareConfig.previousSecret,
    previousValidUntil: shareConfig.previousValidUntil,
  });
  return Object.freeze({ authService, guestService, loginRateLimitService, shareService });
}

function createContainer(env = process.env) {
  const config = loadConfig(env);
  const shareConfig = loadShareConfig({ env, nodeEnv: config.nodeEnv });
  const db = initDatabase(config.dbPath);
  const repositories = createRepositories(db, config);
  const settingsStore = createSettingsStore({ db, config });
  initializePersistence(db, repositories);
  const storage = createStorageServices({ db, config, repositories });
  const identity = createIdentityServices({ db, config, shareConfig, repositories });
  return {
    config,
    db,
    ...identity,
    ...repositories,
    ...storage,
    settingsStore,
  };
}

module.exports = {
  createContainer,
};
