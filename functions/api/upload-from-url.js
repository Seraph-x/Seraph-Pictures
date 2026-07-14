import { checkAuthentication, isAuthRequired } from '../utils/auth.js';
import { checkGuestUpload, incrementGuestCount, readGuestConfig, getClientIP } from '../utils/guest.js';
import { createAuthErrorResponse } from '../utils/auth/http-errors.js';
import { hasHuggingFaceConfig } from '../utils/huggingface.js';
import { hasWebDAVConfig } from '../utils/webdav.js';
import { hasGitHubConfig } from '../utils/github.js';
import { resolveStorageEnv } from '../utils/storage-config.js';
import capabilityModule from '../../shared/storage/capabilities.cjs';
import { fetchRemote } from '../services/url-upload-fetch.js';
import { buildFileName, getFileExtension, jsonResponse, normalizeFolderPath } from '../services/url-upload-common.js';
import { executeProfileUpload } from '../services/profile-upload.js';
import { normalizeUploadSelection } from '../services/upload-selection.js';
import { uploadToTelegramStorage } from '../services/direct-upload-telegram.js';
import {
  uploadToR2, uploadToS3, uploadToDiscordStorage, uploadToHFStorage,
  uploadToWebDAVStorage, uploadToGitHubStorage,
} from '../services/direct-upload-backends.js';
import { normalizeFirstPartyUploadAccess } from '../services/upload-access.js';

const { validateUploadCapability, validateUploadMode } = capabilityModule;
const GUEST_RETENTION_DAYS = 3;

async function isUserAuthenticated(context) {
  if (!isAuthRequired(context.env)) return true;
  return (await checkAuthentication(context)).authenticated;
}

async function readInput(context) {
  const body = await context.request.json();
  const url = String(body?.url || '').trim();
  if (!url) throw Object.assign(new Error('URL is required'), { status: 400 });
  const isAdmin = await isUserAuthenticated(context);
  const guestConfig = isAdmin ? null : await readGuestConfig(context.env);
  const selection = normalizeUploadSelection({
    isAdmin,
    isApi: Boolean(context?.data?.apiToken),
    storageMode: body?.storageMode,
    storageId: body?.storageId,
  });
  const input = Object.freeze({
    url, isAdmin, guestConfig,
    ...selection,
    uploadSource: String(body?.uploadSource || 'image-host'),
    folderPath: normalizeFolderPath(body?.folderPath || body?.folder || ''),
  });
  validateUploadMode({
    runtime: 'cloudflare', type: input.storageMode, mode: 'direct',
    audience: input.isAdmin ? 'admin' : 'guest',
  });
  return input;
}

async function validateGuest(input, context, fileSize) {
  if (input.isAdmin) return;
  const check = await checkGuestUpload(context.request, context.env, fileSize, input.guestConfig);
  if (!check.allowed) throw Object.assign(new Error(check.reason), { status: check.status || 403 });
}

function configured(type, env) {
  const checks = {
    r2: Boolean(env.R2_BUCKET), s3: Boolean(env.S3_ENDPOINT && env.S3_ACCESS_KEY_ID),
    discord: Boolean(env.DISCORD_WEBHOOK_URL || env.DISCORD_BOT_TOKEN),
    huggingface: hasHuggingFaceConfig(env), webdav: hasWebDAVConfig(env),
    github: hasGitHubConfig(env), telegram: true,
  };
  return checks[type];
}

function backendOptions(input, file, env) {
  return Object.freeze({
    file, fileName: file.name, extension: getFileExtension(file.name),
    env, folderPath: input.folderPath,
  });
}

async function dispatch(dispatchInput) {
  const { input, file, env, request } = dispatchInput;
  if (!configured(input.storageMode, env)) {
    throw Object.assign(new Error(`${input.storageMode} is not configured.`), { status: 500 });
  }
  const options = backendOptions(input, file, env);
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

async function executeUpload(input, context) {
  const fetched = await fetchRemote(input.url, context.env);
  if (!fetched.ok) return jsonResponse({ error: fetched.error }, fetched.status || 502);
  const fileSize = fetched.arrayBuffer.byteLength;
  if (!fileSize) return jsonResponse({ error: 'Remote file is empty' }, 400);
  await validateGuest(input, context, fileSize);
  validateUploadCapability({
    runtime: 'cloudflare', type: input.storageMode, mode: 'direct', fileSize,
    audience: input.isAdmin ? 'admin' : 'guest',
  });
  const fileName = buildFileName(fetched.finalUrl, fetched.contentType);
  const file = new File([fetched.arrayBuffer], fileName, { type: fetched.contentType });
  if (input.isAdmin) {
    return executeProfileUpload({
      context,
      selection: { storageMode: input.storageMode, storageId: input.storageId },
      upload: {
        file, fileName, extension: getFileExtension(fileName),
        folderPath: input.folderPath, origin: new URL(context.request.url).origin,
        access: normalizeFirstPartyUploadAccess({ uploadSource: input.uploadSource }),
      },
    });
  }
  const env = await resolveStorageEnv(context.env);
  const response = await dispatch({ input, file, env, request: context.request });
  if (!input.isAdmin && response.ok) {
    await incrementGuestCount(context.request, context.env, input.guestConfig);
  }
  return response;
}

export async function onRequestPost(context) {
  try {
    return await executeUpload(await readInput(context), context);
  } catch (error) {
    const authError = createAuthErrorResponse(error);
    if (authError) return authError;
    const status = error.status || 500;
    if (status >= 500) console.error('URL upload error:', error);
    return jsonResponse({ error: error.code || error.message }, status);
  }
}
