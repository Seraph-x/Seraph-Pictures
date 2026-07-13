/**
 * 检查认证状态 API
 * GET /api/auth/check
 */
import {
  AuthCoordinatorError,
  checkAuthentication,
  isAuthRequired
} from '../../utils/auth.js';
import { getGuestConfig } from '../../utils/guest.js';

export async function onRequestGet(context) {
  const { env } = context;

  try {
    const guestConfig = await getGuestConfig(env);

    // 如果没有配置认证
    if (!isAuthRequired(env)) {
      return new Response(JSON.stringify({
        authenticated: true,
        authRequired: false,
        message: '无需登录',
        guestUpload: guestConfig
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const authResult = await checkAuthentication(context);

    return new Response(JSON.stringify({
      authenticated: authResult.authenticated,
      authRequired: true,
      reason: authResult.reason,
      guestUpload: guestConfig
    }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    if (!(error instanceof AuthCoordinatorError)) console.error('Auth check error:', error);
    return new Response(JSON.stringify({
      authenticated: false,
      authRequired: true,
      error: { code: error.code || 'AUTH_CHECK_FAILED' }
    }), {
      status: error instanceof AuthCoordinatorError ? error.status : 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
