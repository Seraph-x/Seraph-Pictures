import { verifyBasicAuth as verifyBasicRequest } from './auth/basic-auth.js';
import { callAuthCoordinator } from './auth/coordinator-client.js';
import {
  createClearSessionCookieHeader,
  createLegacyClearSessionCookieHeaders,
  createSessionCookieHeader,
  getSessionFromCookie,
} from './auth/cookies.js';
import { AuthCoordinatorError } from './auth/errors.js';

export {
  AuthCoordinatorError,
  createClearSessionCookieHeader,
  createLegacyClearSessionCookieHeaders,
  createSessionCookieHeader,
  getSessionFromCookie,
};

function isTruthy(value) {
  if (value == null || value === '') return false;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

export function isAuthRequired(env = {}) {
  if (!isTruthy(env.AUTH_DISABLED)) return true;
  if (env.APP_ENV === 'local') return false;
  throw new AuthCoordinatorError('INSECURE_PRODUCTION_CONFIG', 500);
}

export function verifyCredentials(username, password, env) {
  return callAuthCoordinator(env, 'verifyCredentials', { username, password });
}

function timingSafeEqual(left, right) {
  const a = String(left ?? '');
  const b = String(right ?? '');
  const length = Math.max(a.length, b.length, 1);
  let mismatch = a.length === b.length ? 0 : 1;
  for (let index = 0; index < length; index += 1) {
    mismatch |= (a.charCodeAt(index) | 0) ^ (b.charCodeAt(index) | 0);
  }
  return mismatch === 0;
}

export async function loginWithCredentials(username, password, env) {
  const status = await callAuthCoordinator(env, 'status');
  if (status.initialized) {
    return callAuthCoordinator(env, 'bootstrapLogin', { username, password });
  }
  const seedMatches = timingSafeEqual(username, env.BASIC_USER)
    && timingSafeEqual(password, env.BASIC_PASS);
  if (!seedMatches) return Object.freeze({ ok: false, code: 'INVALID_CREDENTIALS' });
  return callAuthCoordinator(env, 'bootstrapLogin', {
    username,
    password,
    bootstrapAuthorized: true,
  });
}

export function verifySession(sessionToken, env) {
  return callAuthCoordinator(env, 'verifySession', { token: sessionToken });
}

export async function createSession(username, env) {
  const result = await callAuthCoordinator(env, 'issueSession', { username });
  if (!result.ok) throw new AuthCoordinatorError(result.code || 'SESSION_ISSUE_FAILED', 503);
  return result.session.token;
}

export function deleteSession(sessionToken, env) {
  return callAuthCoordinator(env, 'logout', { token: sessionToken });
}

export function changeAdminCredentials(input, env) {
  return callAuthCoordinator(env, 'changeCredentials', input);
}

export async function readAdminCredentials(env) {
  const profile = await callAuthCoordinator(env, 'readProfile');
  return Object.freeze({
    username: profile.username || '',
    credVersion: profile.credVersion || 0,
    source: 'coordinator',
    updatedAt: null,
  });
}

export function verifyBasicAuth(request, env) {
  return verifyBasicRequest(request, (username, password) => verifyCredentials(username, password, env));
}

export async function checkAuthentication(context) {
  const { request, env } = context;
  if (!isAuthRequired(env)) return Object.freeze({ authenticated: true, reason: 'auth-disabled' });
  await callAuthCoordinator(env, 'status');
  const sessionToken = getSessionFromCookie(request);
  if (sessionToken && await verifySession(sessionToken, env)) {
    return Object.freeze({ authenticated: true, reason: 'session', token: sessionToken });
  }
  const basic = await verifyBasicAuth(request, env);
  if (basic) {
    return Object.freeze({ authenticated: true, reason: 'basic-auth', user: basic.user });
  }
  return Object.freeze({ authenticated: false });
}
