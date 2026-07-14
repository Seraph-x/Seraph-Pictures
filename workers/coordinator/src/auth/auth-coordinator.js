import { AuthRepository } from './auth-repository.js';
import { AuthService } from './auth-service.js';
import { createBootstrapCredentials, createPasswordService } from './password.js';
import { ConfigStateRepository } from '../config/config-state-repository.js';
import { ConfigStateService } from '../config/config-state-service.js';
import { ShareRepository } from '../share/share-repository.js';
import { ShareCoordinatorService } from '../share/share-coordinator.js';
import { GuestQuotaRepository } from '../quota/quota-repository.js';
import { GuestQuotaService } from '../quota/quota-coordinator.js';
import { MutationBarrierRepository } from '../mutation/mutation-barrier-repository.js';
import { StorageReferenceRepository } from '../storage-references/reference-repository.js';
import { StorageReferenceService } from '../storage-references/reference-service.js';
import { OPERATION_METHODS, routeAuthOperation } from './operation-router.js';
import barrierModule from '../../../../shared/security/mutation-barrier-service.cjs';

const { MutationBarrierService } = barrierModule;

export { routeAuthOperation } from './operation-router.js';

function createTokenService(cryptoImpl) {
  return Object.freeze({
    create() {
      const bytes = new Uint8Array(32);
      cryptoImpl.getRandomValues(bytes);
      return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    },
  });
}

function createAlarmScheduler(storage) {
  return Object.freeze({
    async schedule(timestamp) {
      const current = await storage.getAlarm();
      if (current === null || timestamp < current) await storage.setAlarm(timestamp);
    },
    async replace(timestamp) {
      if (timestamp === null) return storage.deleteAlarm();
      return storage.setAlarm(timestamp);
    },
  });
}

function createDependencies(ctx) {
  const clock = Object.freeze({ now: () => Date.now() });
  const tokens = createTokenService(crypto);
  return Object.freeze({
    auth: Object.freeze({
      repository: new AuthRepository(ctx.storage),
      passwords: createPasswordService({ cryptoImpl: crypto }),
      tokens,
      clock,
      bootstrapCredentials: createBootstrapCredentials(),
    }),
    clock,
    tokens,
  });
}

function createCoordinatorServices(ctx) {
  const dependencies = createDependencies(ctx);
  const alarms = createAlarmScheduler(ctx.storage);
  const barrierRepository = new MutationBarrierRepository(ctx.storage);
  return Object.freeze({
    auth: new AuthService(dependencies.auth),
    config: new ConfigStateService({
      repository: new ConfigStateRepository(ctx.storage),
      clock: dependencies.clock,
      alarms,
    }),
    share: new ShareCoordinatorService({
      repository: new ShareRepository(ctx.storage),
    }),
    quota: new GuestQuotaService({
      repository: new GuestQuotaRepository(ctx.storage),
      clock: dependencies.clock,
      ids: dependencies.tokens,
      alarms,
    }),
    barrier: new MutationBarrierService({
      repository: barrierRepository,
      clock: dependencies.clock,
      ids: dependencies.tokens,
      alarms,
    }),
    references: new StorageReferenceService({
      repository: new StorageReferenceRepository(ctx.storage),
      barrier: barrierRepository,
      clock: dependencies.clock,
      alarms,
    }),
    alarms,
  });
}

function operationService(services) {
  return Object.freeze({
    ...bindMethods(services.auth, OPERATION_METHODS),
    configReadAuthority: (payload) => services.config.readAuthority(payload),
    configBegin: (payload) => services.config.begin(payload),
    configCommit: (payload) => services.config.commit(payload),
    configAbort: (payload) => services.config.abort(payload),
    configAbortStale: (payload) => services.config.abortStale(payload),
    shareCreate: (payload) => services.share.create(payload),
    shareRead: (payload) => services.share.read(payload),
    shareConsume: (payload) => services.share.consume(payload),
    shareRevoke: (payload) => services.share.revoke(payload),
    shareLeaseRead: (payload) => services.share.leaseRead(payload),
    shareConsumeStartLease: (payload) => services.share.consumeStartLease(payload),
    shareLeaseAdvance: (payload) => services.share.leaseAdvance(payload),
    quotaReserve: (payload) => services.quota.reserve(payload),
    quotaComplete: (payload) => services.quota.complete(payload),
    quotaCancel: (payload) => services.quota.cancel(payload),
    quotaReleaseExpired: (payload) => services.quota.releaseExpired(payload),
    mutationEnter: (payload) => services.barrier.enter(payload),
    mutationExit: (payload) => services.barrier.exit(payload),
    mutationFreezeBegin: (payload) => services.barrier.freezeBegin(payload),
    mutationFreezeEnd: (payload) => services.barrier.freezeEnd(payload),
    mutationFreezeAbort: (payload) => services.barrier.freezeAbort(payload),
    mutationFreezeStatus: (payload) => services.barrier.status(payload),
    mutationReleaseExpired: (payload) => services.barrier.releaseExpired(payload),
    storageProfileCatalogReadAuthority: (payload) => services.references.readAuthority(payload),
    storageProfileCatalogActivate: (payload) => services.references.activateCatalog(payload),
    storageProfileLedgerStage: (payload) => services.references.stageLedger(payload),
    storageRefReserve: (payload) => services.references.reserve(payload),
    storageRefCommitStart: (payload) => services.references.commitStart(payload),
    storageRefCommitFinish: (payload) => services.references.commitFinish(payload),
    storageRefReleaseStart: (payload) => services.references.releaseStart(payload),
    storageRefReleaseFinish: (payload) => services.references.releaseFinish(payload),
    storageRefTransferStart: (payload) => services.references.transferStart(payload),
    storageRefTransferFinish: (payload) => services.references.transferFinish(payload),
    storageRefReconcile: (payload) => services.references.reconcile(payload),
  });
}

export class AuthCoordinator {
  constructor(ctx, env) {
    void env;
    const services = createCoordinatorServices(ctx);
    this.service = operationService(services);
    this.configService = services.config;
    this.quotaService = services.quota;
    this.barrierService = services.barrier;
    this.referenceService = services.references;
    this.alarms = services.alarms;
  }

  fetch(request) {
    return routeAuthOperation({ request, service: this.service });
  }

  async alarm() {
    await Promise.all([
      this.configService.abortStale({}),
      this.quotaService.releaseExpired({}),
      this.barrierService.releaseExpired({}),
      this.referenceService.releaseExpired({}),
    ]);
    const candidates = [
      this.configService.nextAlarmAt(),
      this.quotaService.nextAlarmAt(),
      this.barrierService.nextAlarmAt(),
      this.referenceService.nextAlarmAt(),
    ].filter(Number.isFinite);
    await this.alarms.replace(candidates.length ? Math.min(...candidates) : null);
  }
}

function bindMethods(service, operationMethods) {
  const entries = Object.entries(operationMethods)
    .filter(([operation]) => !['config', 'share', 'quota', 'mutation', 'storage'].some((prefix) => (
      operation.startsWith(prefix)
    )))
    .map(([operation, method]) => [operation, service[method].bind(service)]);
  return Object.fromEntries(entries);
}
