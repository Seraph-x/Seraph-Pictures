const { transaction } = require('../../db');
const { randomId } = require('../utils/crypto');
const { normalizeStorageType } = require('../storage/common');
const { mergeStorageConfig } = require('../../../shared/storage/contracts.cjs');
const { resolveProfileSelection } = require('../../../shared/storage/profile-policy.cjs');
const { mapStorageRow } = require('./storage-config/row-mapper');
const { StorageConfigQueryRepository } = require('./storage-config/query-repo');
const { StorageConfigMutationRepository } = require('./storage-config/mutation-repo');
const { StorageReferenceRepository } = require('./storage-config/reference-repo');
const { StorageMigrationLockRepository } = require('./storage-config/migration-lock-repo');

const BOOTSTRAP_ORDER = Object.freeze([
  ['telegram', 'Telegram'], ['r2', 'R2'], ['s3', 'S3'], ['discord', 'Discord'],
  ['huggingface', 'HUGGINGFACE'], ['webdav', 'WEBDAV'], ['github', 'GITHUB'],
]);

class StorageConfigRepository {
  constructor(db, appConfig, dependencies = {}) {
    this.db = db;
    this.appConfig = appConfig;
    const mapper = (row, includeSecrets) => mapStorageRow({
      row, includeSecrets, encryptionKey: appConfig.configEncryptionKey,
    });
    this.queries = new StorageConfigQueryRepository({ db, mapRow: mapper });
    this.references = new StorageReferenceRepository({ db, clock: dependencies.clock });
    this.migrationLock = new StorageMigrationLockRepository({ db, clock: dependencies.clock });
    this.mutations = new StorageConfigMutationRepository({
      db,
      queries: this.queries,
      references: this.references,
      lock: this.migrationLock,
      encryptionKey: appConfig.configEncryptionKey,
      mergeConfig: mergeStorageConfig,
      ids: dependencies.ids || { create: () => randomId('sc') },
      clock: dependencies.clock || Date,
    });
  }

  list(includeSecrets = false) { return this.queries.list(includeSecrets); }
  getById(id, includeSecrets = true) { return this.queries.getById(id, includeSecrets); }
  findEnabledByType(type) { return this.queries.findEnabledByType(normalizeStorageType(type)); }
  create(input) { return this.mutations.create({ ...input, type: normalizeStorageType(input.type) }); }
  update(id, patch) {
    const type = patch.type ? normalizeStorageType(patch.type) : undefined;
    return this.mutations.update(id, { ...patch, ...(type ? { type } : {}) });
  }
  delete(id) { return this.mutations.delete(id); }
  setDefault(id) { return this.mutations.setDefault(id); }
  reserveReference(input) {
    return transaction(this.db, () => {
      this.migrationLock.assertUnlocked();
      return this.references.reserve(input);
    });
  }
  releaseReference(operationId) { return transaction(this.db, () => this.references.release(operationId)); }
  commitReference(operationId, operation) {
    return transaction(this.db, () => {
      this.references.assertState(operationId, 'committing');
      const result = operation();
      this.references.release(operationId);
      return result;
    });
  }
  createChunkReference(operation) {
    return transaction(this.db, () => {
      this.migrationLock.assertUnlocked();
      return operation();
    });
  }
  acquireMigrationLock(input) { return transaction(this.db, () => this.migrationLock.acquire(input)); }
  releaseMigrationLock(input) { return transaction(this.db, () => this.migrationLock.release(input)); }

  resolveStorageSelection({ storageId, storageMode }) {
    return resolveProfileSelection({
      items: this.list(true), storageId,
      storageMode: storageMode ? normalizeStorageType(storageMode) : undefined,
      preferredType: this.preferredType(), forWrite: true,
    });
  }

  preferredType() {
    return normalizeStorageType(this.appConfig.bootstrapDefaultStorage?.type || 'telegram');
  }

  ensureBootstrapStorage() {
    const bootstrap = this.appConfig.bootstrapDefaultStorage;
    if (!bootstrap) return;
    for (const [type, label] of BOOTSTRAP_ORDER) {
      if (!this.bootstrapReady(type, bootstrap[type])) continue;
      if (this.list(true).some((item) => item.type === type)) continue;
      this.create({
        name: `${label} (Env Bootstrap)`,
        type,
        config: this.bootstrapConfig(type, bootstrap[type]),
        metadata: { source: 'env-bootstrap', envSource: bootstrap[type]?.envSource || {} },
      });
    }
  }

  bootstrapConfig(type, config = {}) {
    if (type !== 'r2') return config;
    return { ...config, adapterMode: 's3' };
  }

  bootstrapReady(type, config = {}) {
    const fields = {
      telegram: Boolean(config.botToken && config.chatId),
      r2: Boolean(config.endpoint && config.bucket && config.accessKeyId && config.secretAccessKey),
      s3: Boolean(config.endpoint && config.bucket && config.accessKeyId && config.secretAccessKey),
      discord: Boolean(config.webhookUrl || (config.botToken && config.channelId)),
      huggingface: Boolean(config.token && config.repo),
      webdav: Boolean(config.baseUrl && (config.bearerToken || (config.username && config.password))),
      github: Boolean(config.repo && config.token),
    };
    return fields[type] === true;
  }
}

module.exports = { StorageConfigRepository };
