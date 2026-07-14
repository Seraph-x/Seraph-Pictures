import { checkAuthentication, isAuthRequired } from '../../utils/auth.js';
import { createAuthErrorResponse } from '../../utils/auth/http-errors.js';
import contractModule from '../../../shared/storage/contracts.cjs';
import { createStorageProfileRepository } from './repository.js';
import { testStorageProfile } from './tester.js';

const { storageEnvelope } = contractModule;

function response(kind, payload, status = 200) {
  return Response.json(storageEnvelope(kind, payload), { status });
}

function errorResponse(error) {
  const authError = createAuthErrorResponse(error);
  if (authError) return authError;
  const code = error?.code || error?.message || 'STORAGE_OPERATION_FAILED';
  const status = error?.status || 500;
  if (status >= 500) console.error('Storage profile operation failed:', error);
  return Response.json({ success: false, error: { code } }, { status });
}

async function requireAdministrator(context) {
  if (!isAuthRequired(context.env)) return null;
  const auth = await checkAuthentication(context);
  return auth.authenticated
    ? null
    : Response.json({ success: false, error: { code: 'AUTH_REQUIRED' } }, { status: 401 });
}

export function storageRoute(handler) {
  return async function protectedStorageRoute(context) {
    try {
      const unauthorized = await requireAdministrator(context);
      return unauthorized || await handler(context);
    } catch (error) {
      return errorResponse(error);
    }
  };
}

async function readBody(context) {
  try {
    const body = await context.request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('invalid');
    return body;
  } catch {
    throw Object.assign(new Error('REQUEST_BODY_INVALID'), { code: 'REQUEST_BODY_INVALID', status: 400 });
  }
}

function profileId(context) {
  const id = String(context.params?.id || '').trim();
  if (!id) throw Object.assign(new Error('STORAGE_ID_REQUIRED'), { code: 'STORAGE_ID_REQUIRED', status: 400 });
  return id;
}

export async function listProfiles(context) {
  const items = await createStorageProfileRepository(context.env).list();
  return response('items', items);
}

export async function createProfile(context) {
  const item = await createStorageProfileRepository(context.env).create(await readBody(context));
  return response('item', item);
}

export async function updateProfile(context) {
  const item = await createStorageProfileRepository(context.env).update(profileId(context), await readBody(context));
  if (!item) throw Object.assign(new Error('STORAGE_PROFILE_NOT_FOUND'), {
    code: 'STORAGE_PROFILE_NOT_FOUND', status: 404,
  });
  return response('item', item);
}

export async function deleteProfile(context) {
  const deleted = await createStorageProfileRepository(context.env).delete(profileId(context));
  if (!deleted) throw Object.assign(new Error('STORAGE_PROFILE_NOT_FOUND'), {
    code: 'STORAGE_PROFILE_NOT_FOUND', status: 404,
  });
  return response('success');
}

export async function setDefaultProfile(context) {
  const item = await createStorageProfileRepository(context.env).setDefault(profileId(context));
  if (!item) throw Object.assign(new Error('STORAGE_PROFILE_NOT_FOUND'), {
    code: 'STORAGE_PROFILE_NOT_FOUND', status: 404,
  });
  return response('item', item);
}

export async function testProfileById(context) {
  const item = await createStorageProfileRepository(context.env).get(profileId(context), { includeSecrets: true });
  if (!item) throw Object.assign(new Error('STORAGE_PROFILE_NOT_FOUND'), {
    code: 'STORAGE_PROFILE_NOT_FOUND', status: 404,
  });
  return response('result', await testStorageProfile({ env: context.env, type: item.type, config: item.config }));
}

export async function testDraftProfile(context) {
  const body = await readBody(context);
  return response('result', await testStorageProfile({ env: context.env, type: body.type, config: body.config }));
}
