import { checkAuthentication, isAuthRequired } from '../utils/auth.js';
import { apiError, apiSuccess } from '../utils/api-v1.js';
import { readStorageConfig, writeStorageConfig, describeStorageSchema } from '../utils/storage-config.js';
import { withAuthErrorResponse } from '../utils/auth/http-errors.js';

const GUEST_CONFIG_TYPES = Object.freeze(new Set(['telegramGuest']));

function guestOnly(value = {}) {
  return Object.freeze(Object.fromEntries(
    Object.entries(value).filter(([type]) => GUEST_CONFIG_TYPES.has(type)),
  ));
}

function assertGuestPatch(patch) {
  const forbidden = Object.keys(patch || {}).filter((type) => !GUEST_CONFIG_TYPES.has(type));
  if (forbidden.length > 0) {
    throw Object.assign(new Error('Administrator profiles use /api/storage.'), {
      code: 'STORAGE_PROFILE_CONFIG_FORBIDDEN', status: 400,
    });
  }
  return patch;
}

async function requireAdmin(context) {
  if (!isAuthRequired(context.env)) return null;
  const auth = await checkAuthentication(context);
  if (!auth.authenticated) {
    return apiError('UNAUTHORIZED', '需要先登录管理员账号。', 401);
  }
  return null;
}

export async function onRequestOptions() {
  return new Response(null, { status: 204 });
}

async function handleGet(context) {
  const unauthorized = await requireAdmin(context);
  if (unauthorized) return unauthorized;

  try {
    const { config, secretsPresent } = await readStorageConfig(context.env);
    return apiSuccess({
      config: guestOnly(config),
      secretsPresent: guestOnly(secretsPresent),
      schema: describeStorageSchema().filter((item) => GUEST_CONFIG_TYPES.has(item.type)),
      preferredStorageType: String(context.env.DEFAULT_STORAGE_TYPE || 'telegram').toLowerCase(),
    });
  } catch (error) {
    console.error('[storage-config] GET failed:', error?.message || String(error));
    if (error?.code === 'STORAGE_CONFIG_UNAVAILABLE') {
      return apiError('STORAGE_CONFIG_UNAVAILABLE', '存储配置暂时不可用，请稍后重试。', 503);
    }
    return apiError('STORAGE_CONFIG_READ_FAILED', '读取存储配置失败，请检查 KV 绑定与 Functions 日志。', 500, {
      detail: error?.message || String(error),
    });
  }
}

async function handlePost(context) {
  const unauthorized = await requireAdmin(context);
  if (unauthorized) return unauthorized;

  let body = {};
  try {
    body = await context.request.json();
  } catch {
    body = {};
  }

  const patch = body && typeof body === 'object' && body.config && typeof body.config === 'object'
    ? body.config
    : body;

  try {
    const { config, secretsPresent } = await writeStorageConfig(
      context.env, assertGuestPatch(patch || {}),
    );
    return apiSuccess({ config: guestOnly(config), secretsPresent: guestOnly(secretsPresent) });
  } catch (error) {
    if (error?.code === 'STORAGE_PROFILE_CONFIG_FORBIDDEN') {
      return apiError(error.code, error.message, error.status);
    }
    if (error?.code === 'STORAGE_CONFIG_UNAVAILABLE') {
      return apiError('STORAGE_CONFIG_UNAVAILABLE', '存储配置暂时不可用，请稍后重试。', 503);
    }
    if (error?.code === 'NO_ENC_KEY') {
      return apiError('NO_ENC_KEY', '未配置加密密钥，无法保存密钥字段。请在环境变量中设置 CONFIG_ENCRYPTION_KEY 或 SESSION_SECRET 后重新部署。', 500);
    }
    if (error?.code === 'KV_BINDING_MISSING') {
      return apiError('KV_BINDING_MISSING', '未检测到可用的 KV 命名空间绑定，请在 Cloudflare Pages 绑定 KV 并重新部署。', 500);
    }
    console.error('[storage-config] POST failed:', error?.message || String(error));
    return apiError('STORAGE_CONFIG_WRITE_FAILED', '保存存储配置失败，请检查 KV 绑定权限与 Functions 日志。', 500, {
      detail: error?.message || String(error),
    });
  }
}

export const onRequestGet = withAuthErrorResponse(handleGet);
export const onRequestPost = withAuthErrorResponse(handlePost);
