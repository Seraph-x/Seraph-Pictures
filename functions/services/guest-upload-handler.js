import guestPolicy from '../../shared/security/guest-policy.cjs';
import { readGuestConfig } from '../utils/guest.js';
import { resolveStorageEnv } from '../utils/storage-config.js';
import {
  assertDedicatedGuestStorage,
  cancelGuestUpload,
  completeGuestUpload,
  reserveGuestUpload,
} from './guest-quota.js';
import { prepareRemoteGuestFile } from './guest-remote-file.js';
import { uploadGuestTelegram } from './guest-telegram-storage.js';

const { detectImageMime, GUEST_LIMITS } = guestPolicy;

function errorResponse(error) {
  return new Response(JSON.stringify({ error: error.code || error.message }), {
    status: error.status || 500,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function prepareDirectFile(request) {
  const form = await request.clone().formData();
  const file = form.get('file');
  if (!(file instanceof File)) throw Object.assign(new Error('NO_FILE'), { status: 400 });
  const buffer = await file.arrayBuffer();
  return Object.freeze({
    fileName: String(file.name || 'upload.bin'),
    mimeType: file.type,
    declaredBytes: file.size,
    buffer,
    folderPath: String(form.get('folderPath') || ''),
  });
}

async function prepareUpload(context, pathname, maximumBytes) {
  if (pathname === '/upload') return prepareDirectFile(context.request);
  return prepareRemoteGuestFile(context.request, context.env, maximumBytes);
}

async function executeGuestUpload(context, pathname) {
  const config = await readGuestConfig(context.env);
  if (!config.enabled) throw Object.assign(new Error('GUEST_UPLOAD_DISABLED'), { status: 401 });
  const storageEnv = await resolveStorageEnv(context.env);
  assertDedicatedGuestStorage(storageEnv);
  const configuredMaximum = config.maxFileSize > 0
    ? config.maxFileSize
    : GUEST_LIMITS.maximumFileBytes;
  const maximumBytes = Math.min(configuredMaximum, GUEST_LIMITS.maximumFileBytes);
  const prepared = await prepareUpload(context, pathname, maximumBytes);
  const reservation = await reserveGuestUpload({
    request: context.request,
    env: context.env,
    descriptor: Object.freeze({
      fileName: prepared.fileName,
      mimeType: prepared.mimeType,
      detectedMimeType: detectImageMime(prepared.buffer),
      declaredBytes: prepared.declaredBytes,
      actualBytes: prepared.buffer.byteLength,
      maximumFileBytes: maximumBytes,
      retentionDays: config.retentionDays,
    }),
  });
  let response;
  try {
    response = await uploadGuestTelegram({
      prepared, env: storageEnv, retentionDays: config.retentionDays,
    });
  } catch (error) {
    await cancelGuestUpload(context.env, reservation.reservationId);
    throw error;
  }
  await completeGuestUpload(context.env, reservation.reservationId);
  return response;
}

export async function handleGuestUpload(context, pathname) {
  try {
    return await executeGuestUpload(context, pathname);
  } catch (error) {
    console.error('Guest upload error:', error);
    return errorResponse(error);
  }
}
