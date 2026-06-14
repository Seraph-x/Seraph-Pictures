/**
 * 登录 API
 * POST /api/auth/login
 */
import {
  createSession,
  createSessionCookieHeader,
  isAuthRequired,
  verifyCredentials
} from '../../utils/auth.js';

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_WINDOW_SECONDS = 15 * 60;

function getClientIp(request) {
  return request.headers.get('CF-Connecting-IP')
    || request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim()
    || 'unknown';
}

async function getFailedAttempts(env, ip) {
  if (!env.img_url) return 0;
  try {
    const data = await env.img_url.get(`login_fail:${ip}`, { type: 'json' });
    return Number(data?.count) || 0;
  } catch {
    return 0;
  }
}

async function recordFailedAttempt(env, ip, currentCount) {
  if (!env.img_url) return;
  try {
    await env.img_url.put(
      `login_fail:${ip}`,
      JSON.stringify({ count: currentCount + 1 }),
      { expirationTtl: LOCKOUT_WINDOW_SECONDS }
    );
  } catch (e) {
    console.error('Failed to record login attempt:', e);
  }
}

async function clearFailedAttempts(env, ip) {
  if (!env.img_url) return;
  try {
    await env.img_url.delete(`login_fail:${ip}`);
  } catch {
    // best-effort cleanup
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    // 如果没有配置认证，返回成功
    if (!isAuthRequired(env)) {
      return new Response(JSON.stringify({
        success: true,
        message: '无需登录',
        authRequired: false
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const clientIp = getClientIp(request);
    const failedAttempts = await getFailedAttempts(env, clientIp);
    if (failedAttempts >= MAX_FAILED_ATTEMPTS) {
      return new Response(JSON.stringify({
        success: false,
        message: '尝试次数过多，请稍后再试'
      }), {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': String(LOCKOUT_WINDOW_SECONDS)
        }
      });
    }

    const body = await request.json();
    const username = String(body?.username ?? body?.user ?? '').trim();
    const password = String(body?.password ?? body?.pass ?? '');

    if (!username || password === '') {
      return new Response(JSON.stringify({
        success: false,
        message: 'Missing username or password.'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 验证凭据(KV 哈希优先,回退 env)
    const { ok } = await verifyCredentials(username, password, env);
    if (ok) {
      // 创建会话
      const sessionToken = await createSession(username, env);
      await clearFailedAttempts(env, clientIp);

      return new Response(JSON.stringify({
        success: true,
        message: '登录成功'
      }), {
        headers: {
          'Content-Type': 'application/json',
          'Set-Cookie': createSessionCookieHeader(sessionToken)
        }
      });
    }

    await recordFailedAttempt(env, clientIp, failedAttempts);

    return new Response(JSON.stringify({
      success: false,
      message: '用户名或密码错误'
    }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Login error:', error);
    return new Response(JSON.stringify({
      success: false,
      message: '登录失败'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// 检查登录状态
export async function onRequestGet(context) {
  const { env } = context;
  
  return new Response(JSON.stringify({
    authRequired: isAuthRequired(env)
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
}
