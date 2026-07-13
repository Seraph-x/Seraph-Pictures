/**
 * Passkey 注册:校验并落库
 * POST /api/auth/passkey/register/verify  (需登录)
 */
import { checkAuthentication, isAuthRequired } from '../../../../utils/auth.js';
import { verifyAndStoreRegistration } from '../../../../utils/webauthn.js';
import { createAuthErrorResponse } from '../../../../utils/auth/http-errors.js';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    if (isAuthRequired(env)) {
      const auth = await checkAuthentication(context);
      if (!auth.authenticated) return json({ success: false, message: '需要登录' }, 401);
    }

    const body = await request.json().catch(() => ({}));
    const attestation = body?.response || body?.attestation || body;
    const name = body?.name;

    const result = await verifyAndStoreRegistration({ request, env, response: attestation, name });
    if (!result.verified) {
      return json({ success: false, message: result.error || '验证失败' }, 400);
    }
    return json({ success: true, message: '已注册 Passkey', credential: result.credential });
  } catch (error) {
    const authError = createAuthErrorResponse(error);
    if (authError) return authError;
    console.error('Passkey register verify error:', error);
    return json({ success: false, message: '注册校验失败' }, 500);
  }
}
