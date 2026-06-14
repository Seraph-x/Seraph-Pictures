/**
 * 认证工具模块
 * 支持 Cookie-based 会话认证和 Basic Auth
 */

const SESSION_COOKIE_NAME = 'seraph_pictures_session';
const LEGACY_SESSION_COOKIE_NAMES = ['k_vault_session', 'katelya_session'];
const SESSION_DURATION = 24 * 60 * 60 * 1000; // 24小时

// 管理员凭据存于 KV(密码只存哈希);env 仅作首次引导默认值。
export const ADMIN_CREDENTIALS_KEY = 'admin_credentials';
const PBKDF2_ITERATIONS = 100000;

function bytesToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBytes(b64) {
  const binary = atob(String(b64 ?? ''));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

/**
 * 生成随机 salt(base64)。
 */
export function generateSalt() {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  return bytesToBase64(salt);
}

/**
 * PBKDF2-SHA256 派生密码哈希(base64)。Workers 无原生 bcrypt/argon2,使用 WebCrypto。
 */
export async function hashPassword(password, saltB64, iterations = PBKDF2_ITERATIONS) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(String(password ?? '')),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: base64ToBytes(saltB64), iterations, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  return bytesToBase64(new Uint8Array(bits));
}

/**
 * 生成新的密码记录(随机 salt + 哈希)。
 */
export async function createPasswordRecord(password) {
  const salt = generateSalt();
  const iterations = PBKDF2_ITERATIONS;
  const passwordHash = await hashPassword(password, salt, iterations);
  return { salt, iterations, passwordHash };
}

/**
 * 读取生效的管理员凭据:KV 为准(哈希),读不到则回退到 env 引导默认。
 * 永不返回到任何公开响应——仅供服务端校验使用。
 */
export async function readAdminCredentials(env) {
  if (env?.img_url) {
    try {
      const saved = await env.img_url.get(ADMIN_CREDENTIALS_KEY, { type: 'json' });
      if (saved && saved.username && saved.passwordHash && saved.salt) {
        return {
          username: saved.username,
          passwordHash: saved.passwordHash,
          salt: saved.salt,
          iterations: Number(saved.iterations) || PBKDF2_ITERATIONS,
          credVersion: Number(saved.credVersion) || 1,
          updatedAt: saved.updatedAt || null,
          source: 'kv',
        };
      }
    } catch (e) {
      console.error('Admin credentials read error:', e);
    }
  }
  return {
    username: env?.BASIC_USER || '',
    passwordHash: null,
    salt: null,
    iterations: 0,
    credVersion: 0,
    source: 'env',
  };
}

/**
 * 统一凭据校验:KV 哈希优先,缺失则回退 env 明文比对。
 * @returns {Promise<{ ok: boolean, credVersion: number|null }>}
 */
export async function verifyCredentials(username, password, env) {
  const cred = await readAdminCredentials(env);
  const userOk = timingSafeEqual(username, cred.username);
  let passOk = false;
  if (cred.source === 'kv') {
    const computed = await hashPassword(password, cred.salt, cred.iterations);
    passOk = timingSafeEqual(computed, cred.passwordHash);
  } else {
    passOk = !!env?.BASIC_PASS && timingSafeEqual(password, env.BASIC_PASS);
  }
  const ok = userOk && passOk;
  return { ok, credVersion: ok ? cred.credVersion : null };
}

/**
 * 生成会话令牌
 */
export function generateSessionToken() {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * 时间安全的字符串比较
 */
export function timingSafeEqual(a, b) {
  const strA = String(a ?? '');
  const strB = String(b ?? '');
  let mismatch = strA.length === strB.length ? 0 : 1;
  const len = Math.max(strA.length, strB.length, 1);
  for (let i = 0; i < len; i += 1) {
    // charCodeAt out of range is NaN; NaN | 0 === 0
    mismatch |= (strA.charCodeAt(i) | 0) ^ (strB.charCodeAt(i) | 0);
  }
  return mismatch === 0;
}

/**
 * 验证 Basic Auth 凭据(KV 哈希优先,回退 env)
 */
export async function verifyBasicAuth(request, env) {
  const authorization = request.headers.get('Authorization');
  if (!authorization) return null;

  const [scheme, encoded] = authorization.split(' ');
  if (!encoded || scheme !== 'Basic') return null;

  try {
    const buffer = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
    const decoded = new TextDecoder().decode(buffer).normalize();
    const index = decoded.indexOf(':');

    if (index === -1 || /[\0-\x1F\x7F]/.test(decoded)) return null;

    const user = decoded.substring(0, index);
    const pass = decoded.substring(index + 1);

    const { ok } = await verifyCredentials(user, pass, env);
    if (ok) {
      return { user, authenticated: true };
    }
  } catch (e) {
    console.error('Basic auth decode error:', e);
  }
  return null;
}

/**
 * 从 Cookie 获取会话
 */
export function getSessionFromCookie(request) {
  const cookieHeader = request.headers.get('Cookie');
  if (!cookieHeader) return null;

  const cookies = cookieHeader.split(';').map(c => c.trim());
  for (const cookie of cookies) {
    const [name, value] = cookie.split('=');
    if (name === SESSION_COOKIE_NAME || LEGACY_SESSION_COOKIE_NAMES.includes(name)) {
      return value;
    }
  }
  return null;
}

/**
 * 验证会话令牌(含 credVersion 校验:改密后旧会话自动失效)
 */
export async function verifySession(sessionToken, env) {
  if (!sessionToken || !env.img_url) return false;

  try {
    const sessionData = await env.img_url.get(`session:${sessionToken}`, { type: 'json' });
    if (!sessionData) return false;

    // 检查会话是否过期
    if (Date.now() > sessionData.expiresAt) {
      await env.img_url.delete(`session:${sessionToken}`);
      return false;
    }

    // credVersion 比对:改密会自增 credVersion，旧版本会话立即失效
    const cred = await readAdminCredentials(env);
    const sessionVersion = Number(sessionData.credVersion) || 0;
    if (sessionVersion !== cred.credVersion) {
      await env.img_url.delete(`session:${sessionToken}`);
      return false;
    }

    return true;
  } catch (e) {
    console.error('Session verify error:', e);
    return false;
  }
}

/**
 * 创建会话(写入当前 credVersion)
 */
export async function createSession(user, env) {
  const token = generateSessionToken();
  const cred = await readAdminCredentials(env);
  const sessionData = {
    user,
    credVersion: cred.credVersion,
    createdAt: Date.now(),
    expiresAt: Date.now() + SESSION_DURATION
  };

  await env.img_url.put(`session:${token}`, JSON.stringify(sessionData), {
    expirationTtl: Math.floor(SESSION_DURATION / 1000)
  });

  return token;
}

/**
 * 删除除指定会话外的所有会话(改密时作废其它会话,保留当前)。
 * KV list 最终一致,故配合 credVersion 兜底。
 */
export async function deleteOtherSessions(keepToken, env) {
  if (!env?.img_url) return;
  try {
    let cursor;
    do {
      const listed = await env.img_url.list({ prefix: 'session:', cursor });
      for (const key of listed.keys) {
        if (key.name !== `session:${keepToken}`) {
          await env.img_url.delete(key.name);
        }
      }
      cursor = listed.list_complete ? undefined : listed.cursor;
    } while (cursor);
  } catch (e) {
    console.error('Delete other sessions error:', e);
  }
}

/**
 * 删除会话
 */
export async function deleteSession(sessionToken, env) {
  if (sessionToken && env.img_url) {
    await env.img_url.delete(`session:${sessionToken}`);
  }
}

/**
 * 创建带会话 Cookie 的响应
 */
export function createSessionCookieHeader(token, maxAge = SESSION_DURATION / 1000) {
  return `${SESSION_COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

/**
 * 创建清除会话 Cookie 的响应头
 */
export function createClearSessionCookieHeader() {
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

export function createLegacyClearSessionCookieHeaders() {
  return LEGACY_SESSION_COOKIE_NAMES.map((name) => (
    `${name}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`
  ));
}

/**
 * 检查是否需要认证
 */
export function isAuthRequired(env) {
  return !!(env.BASIC_USER && env.BASIC_PASS);
}

/**
 * 综合认证检查
 */
export async function checkAuthentication(context) {
  const { request, env } = context;
  
  // 如果没有配置认证，直接放行
  if (!isAuthRequired(env)) {
    return { authenticated: true, reason: 'no-auth-required' };
  }
  
  // 检查 Cookie 会话
  const sessionToken = getSessionFromCookie(request);
  if (sessionToken && await verifySession(sessionToken, env)) {
    return { authenticated: true, reason: 'session', token: sessionToken };
  }
  
  // 检查 Basic Auth
  const basicAuth = await verifyBasicAuth(request, env);
  if (basicAuth) {
    return { authenticated: true, reason: 'basic-auth', user: basicAuth.user };
  }
  
  return { authenticated: false };
}
