import { checkAuthentication, isAuthRequired } from '../../utils/auth.js';
import { createAuthErrorResponse } from '../../utils/auth/http-errors.js';
import { uploadMultipartPart } from '../../services/multipart-client.js';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}

async function requireAdmin(context) {
  if (!isAuthRequired(context.env)) return true;
  return (await checkAuthentication(context)).authenticated;
}

function readForm(form) {
  const uploadId = form.get('uploadId');
  const rawIndex = form.get('chunkIndex');
  const chunkIndex = Number(rawIndex);
  const chunk = form.get('chunk');
  const digest = form.get('digest');
  if (!uploadId || rawIndex == null || String(rawIndex).trim() === '' || !chunk || !digest) {
    throw Object.assign(new Error('MULTIPART_PAYLOAD_INVALID'), { status: 400 });
  }
  if (!Number.isSafeInteger(chunkIndex) || chunkIndex < 0) {
    throw Object.assign(new Error('INVALID_CHUNK_INDEX'), { code: 'INVALID_CHUNK_INDEX', status: 400 });
  }
  return Object.freeze({ uploadId, chunkIndex, chunk, digest });
}

export async function onRequestPost(context) {
  try {
    if (!await requireAdmin(context)) return json({ error: 'Unauthorized' }, 401);
    const input = readForm(await context.request.formData());
    const bytes = await input.chunk.arrayBuffer();
    const result = await uploadMultipartPart(context.env, {
      uploadId: input.uploadId, partNumber: input.chunkIndex + 1, digest: input.digest, bytes,
    });
    return json({ success: true, chunkIndex: input.chunkIndex, uploadedChunks: result.uploadedParts });
  } catch (error) {
    const authError = createAuthErrorResponse(error);
    if (authError) return authError;
    return json({ error: error.message, code: error.code }, error.status || 500);
  }
}
