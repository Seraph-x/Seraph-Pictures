import { AuthRepository } from './auth-repository.js';
import { AuthService } from './auth-service.js';
import { createBootstrapCredentials, createPasswordService } from './password.js';

const OPERATION_METHODS = Object.freeze({
  bootstrapLogin: 'bootstrapLogin',
  verifySession: 'verifySession',
  changeCredentials: 'changeCredentials',
  logout: 'logout',
  status: 'status',
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
      bootstrapCredentials: createBootstrapCredentials({
        username: env.BASIC_USER,
        password: env.BASIC_PASS,
      }),
    };
    this.service = new AuthService(dependencies);
  }

  fetch(request) {
    return routeAuthOperation({ request, service: this.service });
  }
}
