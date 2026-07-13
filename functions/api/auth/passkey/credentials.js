/**
 * Passkey 管理:列出 / 重命名 / 删除(需登录)
 * GET    /api/auth/passkey/credentials          列出
 * PATCH  /api/auth/passkey/credentials {id,name} 重命名
 * DELETE /api/auth/passkey/credentials {id}       删除
 */
import { checkAuthentication, isAuthRequired } from '../../../utils/auth.js';
import {
  readCredentials,
  publicCredentialList,
  renameCredential,
  deleteCredential,
} from '../../../utils/webauthn.js';
import { withAuthErrorResponse } from '../../../utils/auth/http-errors.js';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

async function requireLogin(context) {
  if (isAuthRequired(context.env)) {
    const auth = await checkAuthentication(context);
    if (!auth.authenticated) return json({ success: false, message: '需要登录' }, 401);
  }
  return null;
}

async function handleGet(context) {
  const gate = await requireLogin(context);
  if (gate) return gate;
  const { items } = await readCredentials(context.env);
  return json({ success: true, credentials: publicCredentialList(items) });
}

async function handlePatch(context) {
  const gate = await requireLogin(context);
  if (gate) return gate;
  const body = await context.request.json().catch(() => ({}));
  const id = String(body?.id || '');
  const name = String(body?.name || '').trim();
  if (!id || !name) return json({ success: false, message: '参数不完整' }, 400);
  if (name.length > 64) return json({ success: false, message: '名称过长' }, 400);
  const result = await renameCredential(context.env, id, name);
  if (!result.ok) return json({ success: false, message: result.error }, 404);
  return json({ success: true, message: '已重命名' });
}

async function handleDelete(context) {
  const gate = await requireLogin(context);
  if (gate) return gate;
  const body = await context.request.json().catch(() => ({}));
  const id = String(body?.id || '');
  if (!id) return json({ success: false, message: '缺少 id' }, 400);
  const result = await deleteCredential(context.env, id);
  if (!result.ok) return json({ success: false, message: result.error }, 404);
  return json({ success: true, message: '已删除' });
}

export const onRequestGet = withAuthErrorResponse(handleGet);
export const onRequestPatch = withAuthErrorResponse(handlePatch);
export const onRequestDelete = withAuthErrorResponse(handleDelete);
