/**
 * 访客上传工具模块
 * 提供访客上传的权限检查、速率限制,以及后台可配的访客策略读取(KV 为准)。
 */

export const GUEST_CONFIG_KEY = 'guest_config';
export const KV_BINDING_CANDIDATES = ['img_url', 'KV', 'UI_CONFIG_KV'];

// Telegram native single-file ceiling for guest uploads; backend can only lower it.
const MAX_GUEST_FILE_BYTES = 20 * 1024 * 1024;
const MIN_RETENTION_DAYS = 1;
const MAX_RETENTION_DAYS = 3;
const MAX_DAILY_LIMIT = 1000;

export const DEFAULT_GUEST_CONFIG = {
  version: 1,
  enabled: false,
  retentionDays: MAX_RETENTION_DAYS,
  dailyLimit: 10,
  maxFileSize: 5 * 1024 * 1024,
};

function clampNumber(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return min;
  return Math.min(max, Math.max(min, numeric));
}

function parseBooleanFlag(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  const text = String(value ?? '').trim().toLowerCase();
  if (['1', 'true', 'yes', 'on', 'enabled', 'enable'].includes(text)) return true;
  if (['0', 'false', 'no', 'off', 'disabled', 'disable'].includes(text)) return false;
  return fallback;
}

/**
 * 归一化访客配置并夹取到安全范围。
 */
export function normalizeGuestConfig(raw) {
  const base = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const next = { ...DEFAULT_GUEST_CONFIG, ...base };
  return {
    version: 1,
    enabled: parseBooleanFlag(next.enabled, DEFAULT_GUEST_CONFIG.enabled),
    retentionDays: Math.round(clampNumber(next.retentionDays, MIN_RETENTION_DAYS, MAX_RETENTION_DAYS)),
    dailyLimit: Math.round(clampNumber(next.dailyLimit, 0, MAX_DAILY_LIMIT)),
    maxFileSize: Math.round(clampNumber(next.maxFileSize, 0, MAX_GUEST_FILE_BYTES)),
  };
}

/**
 * 环境变量仅用于首次读取时的初始默认值;一旦写入 KV,即以 KV 为准。
 */
export function getEnvGuestDefaults(env = {}) {
  const seed = { ...DEFAULT_GUEST_CONFIG };
  if (env.GUEST_UPLOAD != null) {
    seed.enabled = parseBooleanFlag(env.GUEST_UPLOAD, seed.enabled);
  }
  const envMax = parseInt(env.GUEST_MAX_FILE_SIZE, 10);
  if (Number.isFinite(envMax) && envMax > 0) seed.maxFileSize = envMax;
  const envDaily = parseInt(env.GUEST_DAILY_LIMIT, 10);
  if (Number.isFinite(envDaily) && envDaily >= 0) seed.dailyLimit = envDaily;
  const envRetention = parseInt(env.GUEST_RETENTION_DAYS, 10);
  if (Number.isFinite(envRetention) && envRetention > 0) seed.retentionDays = envRetention;
  return normalizeGuestConfig(seed);
}

function resolveGuestKv(env = {}) {
  for (const name of KV_BINDING_CANDIDATES) {
    const candidate = env?.[name];
    if (candidate && typeof candidate.get === 'function' && typeof candidate.put === 'function') {
      return candidate;
    }
  }
  return null;
}

/**
 * 读取生效的访客配置:KV 为准,读不到则回退到环境变量默认值。
 */
export async function readGuestConfig(env = {}) {
  const kv = resolveGuestKv(env);
  if (kv) {
    try {
      const saved = await kv.get(GUEST_CONFIG_KEY, { type: 'json' });
      if (saved) return normalizeGuestConfig(saved);
    } catch (e) {
      console.error('Guest config read error:', e);
    }
  }
  return getEnvGuestDefaults(env);
}

/**
 * 获取客户端 IP。
 * 只信任 Cloudflare 注入的 CF-Connecting-IP;X-Forwarded-For / X-Real-IP 可被客户端伪造,
 * 一旦用于按 IP 限额会被轻易绕过,故不再回退到它们。
 */
function getClientIP(request) {
  return request.headers.get('CF-Connecting-IP') || '0.0.0.0';
}

/**
 * 获取今日日期字符串 (YYYY-MM-DD)
 */
function getTodayKey() {
  return new Date().toISOString().split('T')[0];
}

/**
 * 距离当天 UTC 结束的秒数(KV TTL 最小 60 秒)
 */
function secondsUntilEndOfUtcDay() {
  const now = Date.now();
  const endOfDay = new Date(now).setUTCHours(24, 0, 0, 0);
  return Math.max(Math.ceil((endOfDay - now) / 1000), 60);
}

/**
 * 检查访客上传权限。
 * @param {Request} request
 * @param {object} env
 * @param {number} fileSize
 * @param {object|null} config 可选:已读取的访客配置,避免重复读 KV
 * @returns {Promise<{ allowed: boolean, reason?: string, status?: number, remaining?: number }>}
 */
export async function checkGuestUpload(request, env, fileSize, config = null) {
  const cfg = config || (await readGuestConfig(env));

  // 是否启用访客上传(以 KV 配置为准)
  if (!cfg.enabled) {
    return { allowed: false, reason: '未启用访客上传，请登录后操作', status: 401 };
  }

  // 单文件大小限制
  if (cfg.maxFileSize > 0 && fileSize > cfg.maxFileSize) {
    const maxMB = (cfg.maxFileSize / 1024 / 1024).toFixed(0);
    return { allowed: false, reason: `访客上传限制：文件大小不能超过 ${maxMB}MB`, status: 413 };
  }

  // 每日上传次数(dailyLimit <= 0 视为不限,跳过计数)
  const dailyLimit = cfg.dailyLimit;
  const kv = resolveGuestKv(env);
  if (kv && dailyLimit > 0) {
    const ip = getClientIP(request);
    const today = getTodayKey();
    const kvKey = `guest:${ip}:${today}`;
    try {
      const countStr = await kv.get(kvKey);
      const currentCount = parseInt(countStr) || 0;

      if (currentCount >= dailyLimit) {
        return {
          allowed: false,
          reason: `访客每日上传上限 ${dailyLimit} 次，今日已用完`,
          status: 429,
          remaining: 0
        };
      }

      return { allowed: true, remaining: dailyLimit - currentCount };
    } catch (e) {
      console.error('Guest rate limit check error:', e);
      // KV 出错时放行，不阻塞用户
      return { allowed: true };
    }
  }

  return { allowed: true };
}

/**
 * 增加访客上传计数。
 * Best-effort: KV 是最终一致的,并发请求可能少计数;按日 key 保证窗口边界正确。
 * @param {object|null} config 可选:已读取的访客配置,避免重复读 KV
 */
export async function incrementGuestCount(request, env, config = null) {
  const kv = resolveGuestKv(env);
  if (!kv) return;

  const cfg = config || (await readGuestConfig(env));
  // 未启用或不限次数时无需计数
  if (!cfg.enabled || cfg.dailyLimit <= 0) return;

  const ip = getClientIP(request);
  const today = getTodayKey();
  const kvKey = `guest:${ip}:${today}`;

  try {
    const countStr = await kv.get(kvKey);
    const currentCount = parseInt(countStr) || 0;
    await kv.put(kvKey, String(currentCount + 1), {
      expirationTtl: secondsUntilEndOfUtcDay()
    });
  } catch (e) {
    console.error('Guest count increment error:', e);
  }
}

/**
 * 获取访客配置信息(供前端展示)。KV 为准,返回公开子集。
 */
export async function getGuestConfig(env) {
  return readGuestConfig(env);
}
