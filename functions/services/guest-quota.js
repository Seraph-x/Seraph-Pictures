import { callCoordinator } from '../utils/auth/coordinator-client.js';
import guestPolicy from '../../shared/security/guest-policy.cjs';

const { validateGuestUpload } = guestPolicy;
const MINIMUM_SECRET_CHARACTERS = 32;

function quotaError(code, status = 503) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  return error;
}

function bytesToHex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function subjectHash(request, env) {
  const secret = String(env.SESSION_SECRET || '');
  if (secret.length < MINIMUM_SECRET_CHARACTERS) {
    throw quotaError('GUEST_QUOTA_SECRET_UNAVAILABLE');
  }
  const address = String(request.headers.get('CF-Connecting-IP') || '0.0.0.0')
    .trim().toLowerCase();
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'HMAC', key, new TextEncoder().encode(address),
  );
  return bytesToHex(new Uint8Array(signature));
}

function assertDescriptor(descriptor) {
  const decision = validateGuestUpload(descriptor);
  if (!decision.allowed) throw quotaError(decision.code, decision.status);
}

export async function reserveGuestUpload({ request, env, descriptor }) {
  assertDescriptor(descriptor);
  const result = await callCoordinator(env, 'quotaReserve', {
    subjectHash: await subjectHash(request, env),
  });
  if (!result.ok) throw quotaError(result.code, 429);
  return Object.freeze({
    reservationId: result.reservationId,
    expiresAt: result.expiresAt,
  });
}

export async function completeGuestUpload(env, reservationId) {
  const result = await callCoordinator(env, 'quotaComplete', { reservationId });
  if (!result.completed) throw quotaError('GUEST_RESERVATION_INVALID', 409);
  return result;
}

export async function cancelGuestUpload(env, reservationId) {
  return callCoordinator(env, 'quotaCancel', { reservationId });
}

export function assertDedicatedGuestStorage(env) {
  if (env.TG_GUEST_BOT_TOKEN && env.TG_GUEST_CHAT_ID) return;
  throw quotaError('GUEST_STORAGE_UNAVAILABLE');
}
