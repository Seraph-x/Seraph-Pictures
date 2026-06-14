/**
 * 管理员账号管理 API
 * GET  /api/auth/credentials  → 返回当前用户名(绝不返回密码哈希)
 * POST /api/auth/credentials  → 改用户名/密码(需有效会话 + 重新验证当前密码)
 */
import {
  ADMIN_CREDENTIALS_KEY,
  checkAuthentication,
  createPasswordRecord,
  createSession,
  createSessionCookieHeader,
  deleteOtherSessions,
  getSessionFromCookie,
  isAuthRequired,
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
  // Basic Auth 以冒号分隔用户名与密码;禁止冒号与控制字符
  if (username.includes(':') || /[\0-\x1F\x7F]/.test(username)) {
    return { error: '用户名包含非法字符' };
  }
  return { username };
}

function validatePassword(value) {
  const password = String(value ?? '');
  if (password.length < MIN_PASSWORD_LENGTH) return { error: `密码至少 ${MIN_PASSWORD_LENGTH} 位` };
  if (password.length > MAX_PASSWORD_LENGTH) return { error: `密码不能超过 ${MAX_PASSWORD_LENGTH} 位` };
  if (/[\0-\x1F\x7F]/.test(password)) return { error: '密码包含非法字符' };
  return { password };
}

export async function onRequestGet(context) {
  const { env } = context;

  if (!env.img_url) {
    return json({ success: false, message: '未绑定 KV，无法管理账号' }, 503);
  }
  if (isAuthRequired(env)) {
    const auth = await checkAuthentication(context);
    if (!auth.authenticated) {
      return json({ success: false, message: '需要登录' }, 401);
    }
  }

  const cred = await readAdminCredentials(env);
  return json({
    success: true,
    username: cred.username,
    source: cred.source,
    updatedAt: cred.updatedAt || null,
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    if (!env.img_url) {
      return json({ success: false, message: '未绑定 KV，无法管理账号' }, 503);
    }

    // 必须有有效会话(或 basic-auth 登录态)
    const auth = await checkAuthentication(context);
    if (!auth.authenticated) {
      return json({ success: false, message: '需要登录' }, 401);
    }

    const body = await request.json().catch(() => ({}));
    const currentPassword = String(body?.currentPassword ?? '');
    const hasNewUsername = body?.newUsername != null && String(body.newUsername).trim() !== '';
    const hasNewPassword = body?.newPassword != null && String(body.newPassword) !== '';

    if (!currentPassword) {
      return json({ success: false, message: '请输入当前密码' }, 400);
    }
    if (!hasNewUsername && !hasNewPassword) {
      return json({ success: false, message: '请填写新的用户名或新密码' }, 400);
    }

    // 重新验证当前密码
    const cred = await readAdminCredentials(env);
    const reauth = await verifyCredentials(cred.username, currentPassword, env);
    if (!reauth.ok) {
      return json({ success: false, message: '当前密码不正确' }, 401);
    }

    // 校验新用户名 / 新密码
    let nextUsername = cred.username;
    if (hasNewUsername) {
      const u = validateUsername(body.newUsername);
      if (u.error) return json({ success: false, message: u.error }, 400);
      nextUsername = u.username;
    }

    // 最终密码:有新密码用新密码,否则沿用当前密码(确保始终以哈希形式落 KV)
    let finalPassword = currentPassword;
    if (hasNewPassword) {
      const p = validatePassword(body.newPassword);
      if (p.error) return json({ success: false, message: p.error }, 400);
      finalPassword = p.password;
    }

    const record = await createPasswordRecord(finalPassword);
    const nextVersion = (Number(cred.credVersion) || 0) + 1;
    const credentials = {
      username: nextUsername,
      passwordHash: record.passwordHash,
      salt: record.salt,
      iterations: record.iterations,
      credVersion: nextVersion,
      updatedAt: Date.now(),
    };

    await env.img_url.put(ADMIN_CREDENTIALS_KEY, JSON.stringify(credentials));

    // 重新签发当前会话(新 credVersion),并作废其它所有旧会话
    const newToken = await createSession(nextUsername, env);
    await deleteOtherSessions(newToken, env);

    return json(
      { success: true, message: '账号已更新', username: nextUsername },
      200,
      { 'Set-Cookie': createSessionCookieHeader(newToken) }
    );
  } catch (error) {
    console.error('Update credentials error:', error);
    return json({ success: false, message: '更新失败' }, 500);
  }
}
