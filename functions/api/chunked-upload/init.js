import { checkAuthentication, isAuthRequired } from '../../utils/auth.js';
import { createChunkPlan } from '../../utils/chunk-policy.js';
import { createAuthErrorResponse } from '../../utils/auth/http-errors.js';
import { initializeMultipart } from '../../services/multipart-client.js';
import { normalizeUploadSelection } from '../../services/upload-selection.js';
import { createCloudflareStorageResolver } from '../../services/storage-runtime/profile-resolver.js';
import capabilityModule from '../../../shared/storage/capabilities.cjs';

const CHUNK_SIZE = 5 * 1024 * 1024;
const UPLOAD_TTL_MS = 60 * 60 * 1000;
const { validateUploadCapability } = capabilityModule;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}

async function requireAdmin(context) {
  if (!isAuthRequired(context.env)) return true;
  return (await checkAuthentication(context)).authenticated;
}

function createUploadId() {
  return crypto.randomUUID();
}

function normalizeInput(body) {
  if (!body.fileName || !body.fileType || !body.rootDigest) {
    throw Object.assign(new Error('MULTIPART_PAYLOAD_INVALID'), { code: 'MULTIPART_PAYLOAD_INVALID', status: 400 });
  }
  const plan = createChunkPlan({
    fileSize: Number(body.fileSize), chunkSize: CHUNK_SIZE, totalChunks: Number(body.totalChunks),
  });
  const selection = normalizeUploadSelection({
    isAdmin: true, isApi: false,
    storageMode: body.storageMode, storageId: body.storageId,
  });
  return Object.freeze({ body, plan, selection });
}

async function resolveProfile(context, selection, fileSize) {
  const resolver = context.data?.storageProfileResolver
    || createCloudflareStorageResolver(context.env);
  const profile = await resolver.resolve({ ...selection, forWrite: true });
  validateUploadCapability({
    runtime: 'cloudflare', type: profile.type, mode: 'multipart', fileSize,
  });
  if (profile.type !== 'r2' || profile.config?.adapterMode !== 'binding') {
    throw Object.assign(new Error('MULTIPART_STORAGE_UNSUPPORTED'), {
      code: 'MULTIPART_STORAGE_UNSUPPORTED', status: 400,
    });
  }
  return profile;
}

export async function onRequestPost(context) {
  try {
    if (!await requireAdmin(context)) return json({ error: 'Unauthorized' }, 401);
    const { body, plan, selection } = normalizeInput(await context.request.json());
    const profile = await resolveProfile(context, selection, plan.fileSize);
    const now = Date.now();
    const uploadId = createUploadId();
    const result = await initializeMultipart(context.env, {
      uploadId, owner: 'admin', visibility: body.visibility || 'private',
      expectedSize: plan.fileSize, partSize: plan.chunkSize, totalParts: plan.totalChunks,
      rootDigest: body.rootDigest, fileName: body.fileName, fileType: body.fileType,
      folderPath: body.folderPath || body.folder || '', createdAt: now, expiresAt: now + UPLOAD_TTL_MS,
      storageConfigId: profile.id, storageType: profile.type,
      storageGeneration: profile.generation,
    });
    return json({ success: true, uploadId, chunkSize: result.partSize, chunkBackend: 'r2' });
  } catch (error) {
    const authError = createAuthErrorResponse(error);
    if (authError) return authError;
    return json({ error: error.message, code: error.code }, error.status || 500);
  }
}
