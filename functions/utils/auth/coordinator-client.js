import { AuthCoordinatorError } from './errors.js';

const COORDINATOR_NAME = 'admin-auth';
const INTERNAL_ORIGIN = 'https://coordinator.internal';
const OPERATIONS = new Set([
  'bootstrapLogin',
  'verifyCredentials',
  'verifySession',
  'issueSession',
  'readProfile',
  'getProfile',
  'changeCredentials',
  'logout',
  'status',
]);

function getStub(env) {
  if (!env?.AUTH_COORDINATOR) throw new AuthCoordinatorError('AUTH_STATE_UNAVAILABLE');
  const id = env.AUTH_COORDINATOR.idFromName(COORDINATOR_NAME);
  return env.AUTH_COORDINATOR.get(id);
}

async function readCoordinatorResponse(response) {
  let body;
  try {
    body = await response.json();
  } catch (error) {
    throw new AuthCoordinatorError('AUTH_COORDINATOR_RESPONSE_INVALID', 503, error);
  }
  if (!response.ok) {
    const code = body?.error?.code || 'AUTH_STATE_UNAVAILABLE';
    throw new AuthCoordinatorError(code, response.status);
  }
  if (!body || !Object.hasOwn(body, 'data')) {
    throw new AuthCoordinatorError('AUTH_COORDINATOR_RESPONSE_INVALID');
  }
  return body.data;
}

export async function callAuthCoordinator(env, operation, payload = {}) {
  if (!OPERATIONS.has(operation)) throw new AuthCoordinatorError('AUTH_OPERATION_INVALID', 500);
  const request = new Request(`${INTERNAL_ORIGIN}/auth/${operation}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  try {
    return await readCoordinatorResponse(await getStub(env).fetch(request));
  } catch (error) {
    if (error instanceof AuthCoordinatorError) throw error;
    throw new AuthCoordinatorError('AUTH_STATE_UNAVAILABLE', 503, error);
  }
}
