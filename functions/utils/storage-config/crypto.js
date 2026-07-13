import { unavailable } from './errors.js';

const ENC_PREFIX = 'enc:v1:';
const AES_IV_BYTES = 12;

function getEncryptionSecret(env) {
  return String(env?.CONFIG_ENCRYPTION_KEY || env?.SESSION_SECRET || '').trim();
}

function bytesToBase64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(String(value || ''));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function importAesKey(env) {
  const secret = getEncryptionSecret(env);
  if (!secret) return null;
  const bytes = new TextEncoder().encode(secret);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith(ENC_PREFIX);
}

export async function encryptValue(env, plaintext) {
  const key = await importAesKey(env);
  if (!key) {
    const error = new Error('Encryption key is not configured.');
    error.code = 'NO_ENC_KEY';
    throw error;
  }
  const iv = crypto.getRandomValues(new Uint8Array(AES_IV_BYTES));
  const data = new TextEncoder().encode(String(plaintext));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
  return `${ENC_PREFIX}${bytesToBase64(iv)}:${bytesToBase64(new Uint8Array(ciphertext))}`;
}

export async function decryptValue(env, stored, { allowPlaintext = false } = {}) {
  if (!isEncrypted(stored)) {
    if (allowPlaintext) return String(stored || '');
    throw unavailable(new Error('Stored secret is not encrypted.'));
  }
  const key = await importAesKey(env);
  if (!key) throw unavailable(new Error('Encryption key is unavailable.'));
  try {
    const [ivPart, dataPart] = stored.slice(ENC_PREFIX.length).split(':');
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64ToBytes(ivPart) },
      key,
      base64ToBytes(dataPart),
    );
    return new TextDecoder().decode(plaintext);
  } catch (error) {
    throw unavailable(error);
  }
}

export async function digestConfig(config) {
  const data = new TextEncoder().encode(JSON.stringify(config));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return `sha256:${[...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}
