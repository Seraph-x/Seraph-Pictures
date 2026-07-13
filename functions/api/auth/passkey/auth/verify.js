/**
 * Passkey 登录:校验断言,成功后签发现有 KV 会话
 * POST /api/auth/passkey/auth/verify
 */
import {
  createSession,
  createSessionCookieHeader,
  readAdminCredentials,
} from '../../../../utils/auth.js';
import { verifyAuthentication } from '../../../../utils/webauthn.js';
import { createAuthErrorResponse } from '../../../../utils/auth/http-errors.js';

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extraHeaders },
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const body = await request.json().catch(() => ({}));
    const assertion = body?.response || body?.assertion || body;

    const result = await verifyAuthentication(request, env, assertion);
    if (!result.verified) {
      return json({ success: false, message: result.error || '验证失败' }, 401);
    }

    const cred = await readAdminCredentials(env);
    const token = await createSession(cred.username || 'admin', env);
    return json(
      { success: true, message: '登录成功' },
      200,
      { 'Set-Cookie': createSessionCookieHeader(token, { secure: env.APP_ENV !== 'local' }) }
    );
  } catch (error) {
    const authError = createAuthErrorResponse(error);
    if (authError) return authError;
    console.error('Passkey auth verify error:', error);
    return json({ success: false, message: '登录校验失败' }, 500);
  }
}
