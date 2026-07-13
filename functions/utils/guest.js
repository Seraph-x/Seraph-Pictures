/**
 * 访客上传工具模块
 * 提供访客上传的权限检查、速率限制,以及后台可配的访客策略读取(KV 为准)。
 */

export const GUEST_CONFIG_KEY = 'guest_config';
export const KV_BINDING_CANDIDATES = ['img_url', 'KV', 'UI_CONFIG_KV'];

// Telegram native single-file ceiling for guest uploads; backend can only lower it.
const MAX_GUEST_FILE_BYTES = 20 * 1024 * 1024;
const DEFAULT_RETENTION_DAYS = 3;

export const DEFAULT_GUEST_CONFIG = {
  version: 1,
  enabled: false,
  retentionDays: DEFAULT_RETENTION_DAYS,
  dailyLimit: 10,
  maxFileSize: 5 * 1024 * 1024,
};

function clampNumber(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return min;
  return Math.min(max, Math.max(min, numeric));
}

// Guest file retention in days: any non-negative integer; 0 means never expire.
function clampRetentionDays(value) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_RETENTION_DAYS;
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
    retentionDays: clampRetentionDays(next.retentionDays),
    dailyLimit: DEFAULT_GUEST_CONFIG.dailyLimit,
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
  if (Number.isFinite(envRetention) && envRetention >= 0) seed.retentionDays = envRetention;
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
export function getClientIP(request) {
  void request;
  return 'redacted';
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
  void request;
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

  return {
    allowed: false,
    reason: 'Guest upload must pass through the atomic quota middleware.',
    status: 503,
    code: 'GUEST_ATOMIC_GATE_REQUIRED',
  };
}

/**
 * 增加访客上传计数。
 * Best-effort: KV 是最终一致的,并发请求可能少计数;按日 key 保证窗口边界正确。
 * @param {object|null} config 可选:已读取的访客配置,避免重复读 KV
 */
export async function incrementGuestCount(request, env, config = null) {
  void request;
  void env;
  void config;
  throw Object.assign(new Error('GUEST_ATOMIC_GATE_REQUIRED'), { status: 503 });
}

/**
 * 获取访客配置信息(供前端展示)。KV 为准,返回公开子集。
 */
export async function getGuestConfig(env) {
  return readGuestConfig(env);
}
