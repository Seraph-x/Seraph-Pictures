import { checkAuthentication, isAuthRequired } from '../../utils/auth.js';
import { createChunkPlan } from '../../utils/chunk-policy.js';
import { createAuthErrorResponse } from '../../utils/auth/http-errors.js';
import { initializeMultipart } from '../../services/multipart-client.js';

const CHUNK_SIZE = 5 * 1024 * 1024;
const UPLOAD_TTL_MS = 60 * 60 * 1000;

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
  if (body?.storageMode !== 'r2') {
    throw Object.assign(new Error('MULTIPART_STORAGE_UNSUPPORTED'), { code: 'MULTIPART_STORAGE_UNSUPPORTED', status: 400 });
  }
  if (!body.fileName || !body.fileType || !body.rootDigest) {
    throw Object.assign(new Error('MULTIPART_PAYLOAD_INVALID'), { code: 'MULTIPART_PAYLOAD_INVALID', status: 400 });
  }
  const plan = createChunkPlan({
    fileSize: Number(body.fileSize), chunkSize: CHUNK_SIZE, totalChunks: Number(body.totalChunks),
  });
  return Object.freeze({ body, plan });
}

export async function onRequestPost(context) {
  try {
    if (!await requireAdmin(context)) return json({ error: 'Unauthorized' }, 401);
    const { body, plan } = normalizeInput(await context.request.json());
    const now = Date.now();
    const uploadId = createUploadId();
    const result = await initializeMultipart(context.env, {
      uploadId, owner: 'admin', visibility: body.visibility || 'private',
      expectedSize: plan.fileSize, partSize: plan.chunkSize, totalParts: plan.totalChunks,
      rootDigest: body.rootDigest, fileName: body.fileName, fileType: body.fileType,
      folderPath: body.folderPath || body.folder || '', createdAt: now, expiresAt: now + UPLOAD_TTL_MS,
    });
    return json({ success: true, uploadId, chunkSize: result.partSize, chunkBackend: 'r2' });
  } catch (error) {
    const authError = createAuthErrorResponse(error);
    if (authError) return authError;
    return json({ error: error.message, code: error.code }, error.status || 500);
  }
}
