import {
  AuthCoordinatorError,
  changeAdminCredentials,
  checkAuthentication,
  createSessionCookieHeader,
  getSessionFromCookie,
  readAdminCredentials,
  verifyCredentials,
} from '../../utils/auth.js';

const MAX_USERNAME_LENGTH = 64;
const MIN_PASSWORD_LENGTH = 6;
const MAX_PASSWORD_LENGTH = 256;

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extraHeaders },
  });
}

function validateUsername(value) {
  const username = String(value ?? '').trim();
  if (!username) return { error: '用户名不能为空' };
  if (username.length > MAX_USERNAME_LENGTH) return { error: `用户名不能超过 ${MAX_USERNAME_LENGTH} 个字符` };
  if (username.includes(':') || /[\0-\x1F\x7F]/.test(username)) return { error: '用户名包含非法字符' };
  return { username };
}

function validatePassword(value) {
  const password = String(value ?? '');
  if (password.length < MIN_PASSWORD_LENGTH) return { error: `密码至少 ${MIN_PASSWORD_LENGTH} 位` };
  if (password.length > MAX_PASSWORD_LENGTH) return { error: `密码不能超过 ${MAX_PASSWORD_LENGTH} 位` };
  if (/[\0-\x1F\x7F]/.test(password)) return { error: '密码包含非法字符' };
  return { password };
}

function mapError(error) {
  if (error instanceof AuthCoordinatorError) {
    return json({ success: false, message: '认证服务暂不可用', error: { code: error.code } }, error.status);
  }
  console.error('Credential management error:', error);
  return json({ success: false, message: '更新失败' }, 500);
}

async function requireSession(context) {
  const auth = await checkAuthentication(context);
  const token = getSessionFromCookie(context.request);
  if (!auth.authenticated || !token) return null;
  return token;
}

export async function onRequestGet(context) {
  try {
    if (!await requireSession(context)) return json({ success: false, message: '需要登录' }, 401);
    const profile = await readAdminCredentials(context.env);
    return json({
      success: true,
      username: profile.username,
      source: profile.source,
      updatedAt: profile.updatedAt,
    });
  } catch (error) {
    return mapError(error);
  }
}

function resolveNextCredentials(body, profile) {
  const hasUsername = body?.newUsername != null && String(body.newUsername).trim() !== '';
  const hasPassword = body?.newPassword != null && String(body.newPassword) !== '';
  if (!hasUsername && !hasPassword) return { error: '请填写新的用户名或新密码' };
  const username = hasUsername ? validateUsername(body.newUsername) : { username: profile.username };
  if (username.error) return username;
  const password = hasPassword ? validatePassword(body.newPassword) : { password: body.currentPassword };
  if (password.error) return password;
  return { username: username.username, password: password.password };
}

export async function onRequestPost(context) {
  try {
    const sessionToken = await requireSession(context);
    if (!sessionToken) return json({ success: false, message: '需要登录' }, 401);
    const body = await context.request.json().catch(() => ({}));
    const currentPassword = String(body?.currentPassword ?? '');
    if (!currentPassword) return json({ success: false, message: '请输入当前密码' }, 400);
    const profile = await readAdminCredentials(context.env);
    if (!(await verifyCredentials(profile.username, currentPassword, context.env)).ok) {
      return json({ success: false, message: '当前密码不正确' }, 401);
    }
    const next = resolveNextCredentials({ ...body, currentPassword }, profile);
    if (next.error) return json({ success: false, message: next.error }, 400);
    const changed = await changeAdminCredentials({ sessionToken, ...next }, context.env);
    if (!changed.ok) return json({ success: false, message: '需要登录' }, 401);
    return json({ success: true, message: '账号已更新', username: next.username }, 200, {
      'Set-Cookie': createSessionCookieHeader(changed.session.token),
    });
  } catch (error) {
    return mapError(error);
  }
}
