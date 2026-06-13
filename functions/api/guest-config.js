import { checkAuthentication, isAuthRequired } from '../utils/auth.js';
import { apiError, apiSuccess } from '../utils/api-v1.js';
import {
  GUEST_CONFIG_KEY,
  KV_BINDING_CANDIDATES,
  getEnvGuestDefaults,
  normalizeGuestConfig,
} from '../utils/guest.js';

function extractGuestConfigPayload(body = {}) {
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    if (body.config && typeof body.config === 'object' && !Array.isArray(body.config)) {
      return body.config;
    }
    if (body.settings && typeof body.settings === 'object' && !Array.isArray(body.settings)) {
      return body.settings;
    }
    return body;
  }
  return {};
}

function resolveKvBinding(env = {}) {
  for (const name of KV_BINDING_CANDIDATES) {
    const candidate = env?.[name];
    if (candidate && typeof candidate.get === 'function' && typeof candidate.put === 'function') {
      return { name, binding: candidate };
    }
  }
  return null;
}

function missingKvBindingResponse() {
  return apiError(
    'KV_BINDING_MISSING',
    '未检测到可用的 KV 命名空间绑定，请在 Cloudflare Pages -> Settings -> Functions -> KV namespace bindings 中绑定并重新部署。',
    500,
    { expectedBindings: KV_BINDING_CANDIDATES }
  );
}

export async function onRequestOptions() {
  return new Response(null, { status: 204 });
}

export async function onRequestGet(context) {
  const kv = resolveKvBinding(context.env);
  if (!kv) {
    console.error('[guest-config] KV binding missing. Expected one of:', KV_BINDING_CANDIDATES.join(', '));
    return missingKvBindingResponse();
  }

  let saved = null;
  try {
    saved = await kv.binding.get(GUEST_CONFIG_KEY, { type: 'json' });
  } catch (error) {
    console.error('[guest-config] Failed to read config from KV:', {
      binding: kv.name,
      error: error?.message || String(error),
    });
    return apiError(
      'KV_READ_FAILED',
      '读取访客上传配置失败，请检查 KV 绑定与 Functions 日志。',
      500,
      { binding: kv.name, detail: error?.message || String(error) }
    );
  }

  const config = saved ? normalizeGuestConfig(saved) : getEnvGuestDefaults(context.env);
  return apiSuccess({
    config,
    source: saved ? 'kv' : 'default',
    binding: kv.name,
  });
}

export async function onRequestPost(context) {
  const kv = resolveKvBinding(context.env);
  if (!kv) {
    console.error('[guest-config] KV binding missing. Expected one of:', KV_BINDING_CANDIDATES.join(', '));
    return missingKvBindingResponse();
  }

  if (isAuthRequired(context.env)) {
    const auth = await checkAuthentication(context);
    if (!auth.authenticated) {
      console.warn('[guest-config] Unauthorized write attempt blocked.');
      return apiError('UNAUTHORIZED', '需要先登录管理员账号。', 401);
    }
  }

  let body = {};
  try {
    body = await context.request.json();
  } catch {
    body = {};
  }

  const config = normalizeGuestConfig(extractGuestConfigPayload(body));
  try {
    await kv.binding.put(GUEST_CONFIG_KEY, JSON.stringify(config));
  } catch (error) {
    console.error('[guest-config] Failed to write config to KV:', {
      binding: kv.name,
      error: error?.message || String(error),
    });
    return apiError(
      'KV_WRITE_FAILED',
      '保存访客上传配置失败，请检查 KV 绑定权限与 Functions 日志。',
      500,
      { binding: kv.name, detail: error?.message || String(error) }
    );
  }

  return apiSuccess({
    config,
    source: 'kv',
    binding: kv.name,
  });
}
