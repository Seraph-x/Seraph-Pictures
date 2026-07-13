/**
 * Passkey 登录:生成 authentication options(无需登录)
 * POST /api/auth/passkey/auth/options
 */
import { buildAuthenticationOptions, readCredentials } from '../../../../utils/webauthn.js';
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
    const { items } = await readCredentials(env);
    if (items.length === 0) {
      return json({ success: false, message: '尚未注册任何 Passkey' }, 404);
    }

    const options = await buildAuthenticationOptions(request, env);
    return json({ success: true, options });
  } catch (error) {
    const authError = createAuthErrorResponse(error);
    if (authError) return authError;
    console.error('Passkey auth options error:', error);
    return json({ success: false, message: '生成登录选项失败' }, 500);
  }
}
