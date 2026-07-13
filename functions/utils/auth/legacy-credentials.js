import { AuthCoordinatorError } from './errors.js';

export const LEGACY_ADMIN_CREDENTIALS_KEY = 'admin_credentials';
const MIN_LEGACY_ITERATIONS = 100_000;

function decodeBase64(value) {
  const binary = atob(String(value));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function encodeBase64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
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

function normalizeRecord(value) {
  const iterations = Number(value?.iterations);
  if (!value?.username || !value?.passwordHash || !value?.salt) return null;
  if (!Number.isInteger(iterations) || iterations < MIN_LEGACY_ITERATIONS) return null;
  return Object.freeze({
    username: String(value.username),
    passwordHash: String(value.passwordHash),
    salt: String(value.salt),
    iterations,
    credVersion: Math.max(Number(value.credVersion) || 1, 1),
  });
}

async function deriveHash(password, record) {
  const material = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(String(password)), { name: 'PBKDF2' }, false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits({
    name: 'PBKDF2', hash: 'SHA-256', salt: decodeBase64(record.salt), iterations: record.iterations,
  }, material, 256);
  return encodeBase64(new Uint8Array(bits));
}

export async function readLegacyCredential(env) {
  if (!env?.img_url) return null;
  let value;
  try {
    value = await env.img_url.get(LEGACY_ADMIN_CREDENTIALS_KEY, { type: 'json' });
  } catch (error) {
    throw new AuthCoordinatorError('LEGACY_CREDENTIAL_READ_FAILED', 503, error);
  }
  if (!value) return null;
  const record = normalizeRecord(value);
  if (!record) throw new AuthCoordinatorError('LEGACY_CREDENTIAL_INVALID', 503);
  return record;
}

export async function verifyLegacyCredential(input, record) {
  if (!timingSafeEqual(input.username, record.username)) return false;
  return timingSafeEqual(await deriveHash(input.password, record), record.passwordHash);
}

export async function deleteLegacyCredential(env) {
  try {
    await env.img_url.delete(LEGACY_ADMIN_CREDENTIALS_KEY);
  } catch (error) {
    throw new AuthCoordinatorError('LEGACY_CREDENTIAL_CLEANUP_FAILED', 503, error);
  }
}
