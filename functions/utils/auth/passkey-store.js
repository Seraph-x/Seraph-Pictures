import { callAuthCoordinator } from './coordinator-client.js';
import { AuthCoordinatorError } from './errors.js';

const LEGACY_CREDENTIALS_KEY = 'webauthn_credentials';
const LEGACY_PASSKEY_KEYS = Object.freeze([
  LEGACY_CREDENTIALS_KEY,
  'webauthn_challenge:register',
  'webauthn_challenge:auth',
]);

async function readLegacyItems(env) {
  if (!env?.img_url) throw new AuthCoordinatorError('LEGACY_PASSKEY_READ_FAILED', 503);
  let value;
  try {
    value = await env.img_url.get(LEGACY_CREDENTIALS_KEY, { type: 'json' });
  } catch (error) {
    throw new AuthCoordinatorError('LEGACY_PASSKEY_READ_FAILED', 503, error);
  }
  if (!value) return [];
  if (!Array.isArray(value.items)) throw new AuthCoordinatorError('LEGACY_PASSKEY_INVALID', 503);
  return value.items;
}

async function deleteLegacyState(env) {
  try {
    for (const key of LEGACY_PASSKEY_KEYS) await env.img_url.delete(key);
  } catch (error) {
    throw new AuthCoordinatorError('LEGACY_PASSKEY_CLEANUP_FAILED', 503, error);
  }
}

async function ensurePasskeyMigration(env) {
  const status = await callAuthCoordinator(env, 'passkeyMigrationStatus');
  if (status.migrated) {
    if (status.cleanupRequired) await completeLegacyCleanup(env);
    return null;
  }
  const items = await readLegacyItems(env);
  const result = await callAuthCoordinator(env, 'migrateLegacyPasskeys', {
    items,
    migrationAuthorized: true,
  });
  if (!result.ok) throw new AuthCoordinatorError(result.code, 503);
  await completeLegacyCleanup(env);
  return Object.freeze({ items: result.items });
}

async function completeLegacyCleanup(env) {
  await deleteLegacyState(env);
  await callAuthCoordinator(env, 'completeLegacyPasskeyCleanup');
}

export async function listPasskeys(env) {
  return await ensurePasskeyMigration(env) || callAuthCoordinator(env, 'listPasskeys');
}

export async function putPasskeyChallenge(env, kind, challenge) {
  await ensurePasskeyMigration(env);
  return callAuthCoordinator(env, 'putPasskeyChallenge', { kind, challenge });
}

export async function takePasskeyChallenge(env, kind) {
  await ensurePasskeyMigration(env);
  const result = await callAuthCoordinator(env, 'takePasskeyChallenge', { kind });
  return result.challenge;
}

export async function savePasskey(env, credential) {
  await ensurePasskeyMigration(env);
  return callAuthCoordinator(env, 'savePasskey', { credential });
}

export async function updatePasskeyCounter(env, input) {
  await ensurePasskeyMigration(env);
  return callAuthCoordinator(env, 'updatePasskeyCounter', input);
}

export async function renamePasskey(env, id, name) {
  await ensurePasskeyMigration(env);
  return callAuthCoordinator(env, 'renamePasskey', { id, name });
}

export async function deletePasskey(env, id) {
  await ensurePasskeyMigration(env);
  return callAuthCoordinator(env, 'deletePasskey', { id });
}
