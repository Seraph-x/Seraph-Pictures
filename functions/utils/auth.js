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

export function loginWithCredentials(username, password, env) {
  return callAuthCoordinator(env, 'bootstrapLogin', { username, password });
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
