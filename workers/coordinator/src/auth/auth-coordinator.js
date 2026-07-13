import { AuthRepository } from './auth-repository.js';
import { AuthService } from './auth-service.js';
import { createBootstrapCredentials, createPasswordService } from './password.js';
import { ConfigStateRepository } from '../config/config-state-repository.js';
import { ConfigStateService } from '../config/config-state-service.js';
import { ShareRepository } from '../share/share-repository.js';
import { ShareCoordinatorService } from '../share/share-coordinator.js';

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

export class AuthCoordinator {
  constructor(ctx, env) {
    const dependencies = {
      repository: new AuthRepository(ctx.storage),
      passwords: createPasswordService({ cryptoImpl: crypto }),
      tokens: createTokenService(crypto),
      clock: { now: () => Date.now() },
      bootstrapCredentials: createBootstrapCredentials(),
    };
    const authService = new AuthService(dependencies);
    const configService = new ConfigStateService({
      repository: new ConfigStateRepository(ctx.storage),
      clock: dependencies.clock,
      alarms: { schedule: (timestamp) => ctx.storage.setAlarm(timestamp) },
    });
    const shareService = new ShareCoordinatorService({
      repository: new ShareRepository(ctx.storage),
    });
    this.service = Object.freeze({
      ...bindMethods(authService, OPERATION_METHODS),
      configReadAuthority: (payload) => configService.readAuthority(payload),
      configBegin: (payload) => configService.begin(payload),
      configCommit: (payload) => configService.commit(payload),
      configAbort: (payload) => configService.abort(payload),
      configAbortStale: (payload) => configService.abortStale(payload),
      shareCreate: (payload) => shareService.create(payload),
      shareRead: (payload) => shareService.read(payload),
      shareConsume: (payload) => shareService.consume(payload),
      shareRevoke: (payload) => shareService.revoke(payload),
      shareLeaseRead: (payload) => shareService.leaseRead(payload),
      shareConsumeStartLease: (payload) => shareService.consumeStartLease(payload),
      shareLeaseAdvance: (payload) => shareService.leaseAdvance(payload),
    });
    this.configService = configService;
  }

  fetch(request) {
    return routeAuthOperation({ request, service: this.service });
  }

  alarm() {
    return this.configService.abortStale({});
  }
}

function bindMethods(service, operationMethods) {
  const entries = Object.entries(operationMethods)
    .filter(([operation]) => !operation.startsWith('config') && !operation.startsWith('share'))
    .map(([operation, method]) => [operation, service[method].bind(service)]);
  return Object.fromEntries(entries);
}
