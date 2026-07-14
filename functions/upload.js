import { checkAuthentication, isAuthRequired } from './utils/auth.js';
import { checkGuestUpload, incrementGuestCount, readGuestConfig, getClientIP } from './utils/guest.js';
import { createAuthErrorResponse } from './utils/auth/http-errors.js';
import { hasHuggingFaceConfig } from './utils/huggingface.js';
import { hasWebDAVConfig } from './utils/webdav.js';
import { hasGitHubConfig } from './utils/github.js';
import { resolveStorageEnv } from './utils/storage-config.js';
import capabilityModule from '../shared/storage/capabilities.cjs';
import { normalizeFileExtension, normalizeFolderPath, uploadError } from './services/direct-upload-common.js';
import { executeProfileUpload } from './services/profile-upload.js';
import { normalizeUploadSelection } from './services/upload-selection.js';
import { uploadToTelegramStorage } from './services/direct-upload-telegram.js';
import { normalizeFirstPartyUploadAccess } from './services/upload-access.js';
import {
  uploadToR2, uploadToS3, uploadToDiscordStorage, uploadToHFStorage,
  uploadToWebDAVStorage, uploadToGitHubStorage,
} from './services/direct-upload-backends.js';

const { validateUploadCapability } = capabilityModule;
const GUEST_RETENTION_DAYS = 3;

async function isUserAuthenticated(context) {
  if (!isAuthRequired(context.env)) return true;
  return (await checkAuthentication(context)).authenticated;
}

async function parseUpload(context) {
  const form = await context.request.clone().formData();
  const file = form.get('file');
  if (!file) throw Object.assign(new Error('No file uploaded'), { status: 400 });
  const isAdmin = Boolean(context?.data?.apiToken) || await isUserAuthenticated(context);
  const guestConfig = isAdmin ? null : await readGuestConfig(context.env);
  if (!isAdmin) {
    const check = await checkGuestUpload(context.request, context.env, file.size, guestConfig);
    if (!check.allowed) throw Object.assign(new Error(check.reason), { status: check.status || 403 });
  }
  const selection = normalizeUploadSelection({
    isAdmin,
    isApi: Boolean(context?.data?.apiToken),
    storageMode: form.get('storageMode'),
    storageId: form.get('storageId'),
  });
  return Object.freeze({
    file, isAdmin, guestConfig,
    fileName: String(file.name || 'upload.bin'),
    folderPath: normalizeFolderPath(form.get('folderPath')),
    uploadSource: String(form.get('uploadSource') || 'image-host'),
    ...selection,
  });
}

function validateUpload(input) {
  validateUploadCapability({
    runtime: 'cloudflare', type: input.storageMode, mode: 'direct',
    fileSize: input.file.size, audience: input.isAdmin ? 'admin' : 'guest',
  });
}

function missingConfiguration(input, env) {
  const checks = {
    r2: Boolean(env.R2_BUCKET),
    s3: Boolean(env.S3_ENDPOINT && env.S3_ACCESS_KEY_ID),
    discord: Boolean(env.DISCORD_WEBHOOK_URL || env.DISCORD_BOT_TOKEN),
    huggingface: hasHuggingFaceConfig(env),
    webdav: hasWebDAVConfig(env),
    github: hasGitHubConfig(env),
    telegram: true,
  };
  return checks[input.storageMode] ? null : `${input.storageMode} is not configured.`;
}

function uploadOptions(input, env) {
  return Object.freeze({
    file: input.file, fileName: input.fileName,
    extension: normalizeFileExtension(input.fileName), env, folderPath: input.folderPath,
  });
}

async function dispatchUpload(input, env, request) {
  const missing = missingConfiguration(input, env);
  if (missing) return uploadError(missing);
  const options = uploadOptions(input, env);
  if (input.storageMode === 'r2') return uploadToR2(options);
  if (input.storageMode === 's3') return uploadToS3(options);
  if (input.storageMode === 'discord') return uploadToDiscordStorage(options);
  if (input.storageMode === 'huggingface') return uploadToHFStorage(options);
  if (input.storageMode === 'webdav') return uploadToWebDAVStorage(options);
  if (input.storageMode === 'github') return uploadToGitHubStorage(options);
  const guest = input.isAdmin ? null : {
    guest: true, guestIp: getClientIP(request),
    retentionDays: input.guestConfig?.retentionDays ?? GUEST_RETENTION_DAYS,
  };
  return uploadToTelegramStorage({
    ...options, origin: new URL(request.url).origin, guest,
  });
}

function profileUploadAccess(context, input) {
  const pathname = new URL(context.request.url).pathname;
  return normalizeFirstPartyUploadAccess({
    api: pathname === '/api/v1/upload',
    requestedVisibility: context.data?.fileVisibility,
    uploadSource: input.uploadSource,
  });
}

function profileUploadOptions(input, context) {
  return Object.freeze({
    file: input.file,
    fileName: input.fileName,
    extension: normalizeFileExtension(input.fileName),
    folderPath: input.folderPath,
    origin: new URL(context.request.url).origin,
    access: profileUploadAccess(context, input),
  });
}

async function executeAdminUpload(input, context) {
  return executeProfileUpload({
    context,
    selection: { storageMode: input.storageMode, storageId: input.storageId },
    upload: profileUploadOptions(input, context),
  });
}

async function settleGuest(input, context, result) {
  if (input.isAdmin || !(result instanceof Response) || !result.ok) return;
  await incrementGuestCount(context.request, context.env, input.guestConfig);
}

export async function onRequestPost(context) {
  try {
    const input = await parseUpload(context);
    validateUpload(input);
    if (input.isAdmin) return await executeAdminUpload(input, context);
    const env = await resolveStorageEnv(context.env);
    const result = await dispatchUpload(input, env, context.request);
    await settleGuest(input, context, result);
    return result;
  } catch (error) {
    const authError = createAuthErrorResponse(error);
    if (authError) return authError;
    console.error('Upload error:', error);
    return uploadError(error.code || error.message, error.status || 500);
  }
}
