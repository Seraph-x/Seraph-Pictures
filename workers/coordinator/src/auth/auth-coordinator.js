import { AuthRepository } from './auth-repository.js';
import { AuthService } from './auth-service.js';
import { createBootstrapCredentials, createPasswordService } from './password.js';
import { ConfigStateRepository } from '../config/config-state-repository.js';
import { ConfigStateService } from '../config/config-state-service.js';
import { ShareRepository } from '../share/share-repository.js';
import { ShareCoordinatorService } from '../share/share-coordinator.js';
import { GuestQuotaRepository } from '../quota/quota-repository.js';
import { GuestQuotaService } from '../quota/quota-coordinator.js';

const OPERATION_METHODS = Object.freeze({
  bootstrapLogin: 'bootstrapLogin',
  migrateLegacyLogin: 'migrateLegacyLogin',
  completeLegacyCredentialCleanup: 'completeLegacyCredentialCleanup',
  verifyCredentials: 'verifyCredentials',
  verifySession: 'verifySession',
  issueSession: 'issueSession',
  readProfile: 'readProfile',
  getProfile: 'getProfile',
  changeCredentials: 'changeCredentials',
  logout: 'logout',
  status: 'status',
  listPasskeys: 'listPasskeys',
  putPasskeyChallenge: 'putPasskeyChallenge',
  takePasskeyChallenge: 'takePasskeyChallenge',
  savePasskey: 'savePasskey',
  updatePasskeyCounter: 'updatePasskeyCounter',
  renamePasskey: 'renamePasskey',
  deletePasskey: 'deletePasskey',
  passkeyMigrationStatus: 'passkeyMigrationStatus',
  migrateLegacyPasskeys: 'migrateLegacyPasskeys',
  completeLegacyPasskeyCleanup: 'completeLegacyPasskeyCleanup',
  configReadAuthority: 'configReadAuthority',
  configBegin: 'configBegin',
  configCommit: 'configCommit',
  configAbort: 'configAbort',
  configAbortStale: 'configAbortStale',
  shareCreate: 'shareCreate',
  shareRead: 'shareRead',
  shareConsume: 'shareConsume',
  shareRevoke: 'shareRevoke',
  shareLeaseRead: 'shareLeaseRead',
  shareConsumeStartLease: 'shareConsumeStartLease',
  shareLeaseAdvance: 'shareLeaseAdvance',
  quotaReserve: 'quotaReserve',
  quotaComplete: 'quotaComplete',
  quotaCancel: 'quotaCancel',
  quotaReleaseExpired: 'quotaReleaseExpired',
});

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function readPayload(request) {
  try {
    const payload = await request.json();
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error();
    return payload;
  } catch {
    return null;
  }
}

function readOperation(request) {
  return new URL(request.url).pathname.split('/').filter(Boolean).at(-1);
}

export async function routeAuthOperation({ request, service }) {
  if (request.method !== 'POST') return jsonResponse({ error: { code: 'METHOD_NOT_ALLOWED' } }, 405);
  const operation = readOperation(request);
  const method = OPERATION_METHODS[operation];
  if (!method) return jsonResponse({ error: { code: 'COORDINATOR_OPERATION_UNKNOWN' } }, 404);
  const payload = await readPayload(request);
  if (!payload) return jsonResponse({ error: { code: 'COORDINATOR_PAYLOAD_INVALID' } }, 400);
  const data = await service[method](payload);
  return jsonResponse({ data });
}

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
  });
}

export class AuthCoordinator {
  constructor(ctx, env) {
    void env;
    const services = createCoordinatorServices(ctx);
    this.service = operationService(services);
    this.configService = services.config;
    this.quotaService = services.quota;
    this.alarms = services.alarms;
  }

  fetch(request) {
    return routeAuthOperation({ request, service: this.service });
  }

  async alarm() {
    await Promise.all([
      this.configService.abortStale({}),
      this.quotaService.releaseExpired({}),
    ]);
    const candidates = [
      this.configService.nextAlarmAt(),
      this.quotaService.nextAlarmAt(),
    ].filter(Number.isFinite);
    await this.alarms.replace(candidates.length ? Math.min(...candidates) : null);
  }
}

function bindMethods(service, operationMethods) {
  const entries = Object.entries(operationMethods)
    .filter(([operation]) => !['config', 'share', 'quota'].some((prefix) => (
      operation.startsWith(prefix)
    )))
    .map(([operation, method]) => [operation, service[method].bind(service)]);
  return Object.fromEntries(entries);
}
