import { checkAuthentication, isAuthRequired } from '../../utils/auth.js';
import { createAuthErrorResponse } from '../../utils/auth/http-errors.js';
import { completeMultipart } from '../../services/multipart-client.js';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}

async function requireAdmin(context) {
  if (!isAuthRequired(context.env)) return true;
  return (await checkAuthentication(context)).authenticated;
}

export async function onRequestPost(context) {
  try {
    if (!await requireAdmin(context)) return json({ error: 'Unauthorized' }, 401);
    const { uploadId } = await context.request.json();
    if (!uploadId) return json({ error: 'MULTIPART_PAYLOAD_INVALID' }, 400);
    const result = await completeMultipart(context.env, { uploadId });
    return json({
      success: true, src: `/file/${result.fileId}`,
      fileName: result.fileName, fileSize: result.fileSize,
    });
  } catch (error) {
    const authError = createAuthErrorResponse(error);
    if (authError) return authError;
    return json({ error: error.message, code: error.code }, error.status || 500);
  }
}
