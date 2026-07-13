import {
  AuthCoordinatorError,
  createSessionCookieHeader,
  isAuthRequired,
  loginWithCredentials,
} from '../../utils/auth.js';

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_WINDOW_SECONDS = 15 * 60;

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}

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

async function recordFailedAttempt(env, ip, count) {
  if (!env.img_url) return;
  await env.img_url.put(`login_fail:${ip}`, JSON.stringify({ count: count + 1 }), {
    expirationTtl: LOCKOUT_WINDOW_SECONDS,
  });
}

async function clearFailedAttempts(env, ip) {
  if (env.img_url) await env.img_url.delete(`login_fail:${ip}`);
}

function mapLoginError(error) {
  if (error instanceof AuthCoordinatorError) {
    return json({ success: false, message: '登录服务暂不可用', error: { code: error.code } }, error.status);
  }
  console.error('Login error:', error);
  return json({ success: false, message: '登录失败' }, 500);
}

export async function onRequestPost({ request, env }) {
  try {
    if (!isAuthRequired(env)) return json({ success: true, message: '无需登录', authRequired: false });
    const clientIp = getClientIp(request);
    const failedAttempts = await getFailedAttempts(env, clientIp);
    if (failedAttempts >= MAX_FAILED_ATTEMPTS) {
      return json({ success: false, message: '尝试次数过多，请稍后再试' }, 429, {
        'Retry-After': String(LOCKOUT_WINDOW_SECONDS),
      });
    }
    const body = await request.json();
    const username = String(body?.username ?? body?.user ?? '').trim();
    const password = String(body?.password ?? body?.pass ?? '');
    if (!username || !password) return json({ success: false, message: 'Missing username or password.' }, 400);
    const result = await loginWithCredentials(username, password, env);
    if (!result.ok) {
      await recordFailedAttempt(env, clientIp, failedAttempts);
      return json({ success: false, message: '用户名或密码错误' }, 401);
    }
    await clearFailedAttempts(env, clientIp);
    return json({ success: true, message: '登录成功' }, 200, {
      'Set-Cookie': createSessionCookieHeader(result.session.token, { secure: env.APP_ENV !== 'local' }),
    });
  } catch (error) {
    return mapLoginError(error);
  }
}

export function onRequestGet({ env }) {
  try {
    return json({ authRequired: isAuthRequired(env) });
  } catch (error) {
    return mapLoginError(error);
  }
}
