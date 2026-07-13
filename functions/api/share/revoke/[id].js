import { checkAuthentication, isAuthRequired } from '../../../utils/auth.js';
import { createAuthErrorResponse } from '../../../utils/auth/http-errors.js';
import { revokeCloudflareShare } from '../../../services/share-access.js';

function jsonError(code, status) {
  return Response.json({ success: false, error: { code } }, { status });
}

export async function onRequestPost(context) {
  try {
    if (isAuthRequired(context.env)) {
      const auth = await checkAuthentication(context);
      if (!auth.authenticated) return jsonError('AUTH_REQUIRED', 401);
    }
    const result = await revokeCloudflareShare(context.env, context.params.id);
    return result.revoked
      ? Response.json({ success: true, revoked: true })
      : jsonError('SHARE_NOT_FOUND', 404);
  } catch (error) {
    return createAuthErrorResponse(error)
      || jsonError(error?.code || 'SHARE_STATE_UNAVAILABLE', 503);
  }
}

export async function onRequest(context) {
  return context.request.method === 'POST'
    ? onRequestPost(context)
    : jsonError('METHOD_NOT_ALLOWED', 405);
}
