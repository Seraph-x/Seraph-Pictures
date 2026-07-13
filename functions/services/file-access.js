import { checkAuthentication } from '../utils/auth.js';
import accessPolicy from '../../shared/security/access-policy.cjs';
import fileMetadataPolicy from '../../shared/security/file-metadata.cjs';

export const VISIBILITY_SCHEMA_KEY = 'schema:visibility:v1';
const { decideFileAccess } = accessPolicy;
const { resolveStoredAccessMetadata } = fileMetadataPolicy;

function accessError(code, status) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  return error;
}

function hasAuthenticationIntent(context) {
  if (context?.data?.apiToken) return true;
  const headers = context.request.headers;
  const authorization = headers.get('Authorization') || '';
  const cookie = headers.get('Cookie') || '';
  return authorization.startsWith('Basic ') || cookie.includes('seraph_pictures_session=');
}

async function resolveActor(context) {
  if (context?.data?.apiToken) return 'admin';
  if (!hasAuthenticationIntent(context)) return 'anonymous';
  const result = await checkAuthentication(context);
  return result.authenticated ? 'admin' : 'anonymous';
}

export async function readVisibilityMigrationState(env) {
  if (!env?.img_url?.get) throw accessError('FILE_VISIBILITY_UNAVAILABLE', 503);
  let marker;
  try {
    marker = await env.img_url.get(VISIBILITY_SCHEMA_KEY, { type: 'json' });
  } catch (error) {
    throw accessError('FILE_VISIBILITY_UNAVAILABLE', 503, error);
  }
  if (marker === null) return Object.freeze({ complete: false });
  if (marker?.version !== 1 || marker?.complete !== true) {
    throw accessError('FILE_VISIBILITY_INVALID', 500);
  }
  return Object.freeze({ complete: true });
}

export async function authorizeFileRequest(options) {
  const { context, metadata, share = null, migrationComplete } = options;
  const migration = typeof migrationComplete === 'boolean'
    ? Object.freeze({ complete: migrationComplete })
    : await readVisibilityMigrationState(context.env);
  const access = resolveStoredAccessMetadata({
    metadata,
    migrationComplete: migration.complete,
  });
  const actor = await resolveActor(context);
  return decideFileAccess({
    visibility: access.visibility,
    actor,
    share,
    accessVersion: access.accessVersion,
    nowSeconds: Math.floor(Date.now() / 1000),
  });
}

export function fileAccessErrorResponse(error) {
  const status = error?.status || 500;
  const code = error?.code || 'FILE_VISIBILITY_INVALID';
  return Response.json({ error: { code } }, { status });
}
