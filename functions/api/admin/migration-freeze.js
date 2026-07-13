import { callAuthCoordinator } from '../../utils/auth/coordinator-client.js';
import { VISIBILITY_SCHEMA_KEY } from '../../services/file-access.js';
import { checkAuthentication, isAuthRequired } from '../../utils/auth.js';

async function requireAdministrator(context) {
  if (!isAuthRequired(context.env)) return false;
  return (await checkAuthentication(context)).authenticated;
}

function unauthorized() {
  return Response.json({ error: { code: 'ADMIN_AUTH_REQUIRED' } }, { status: 401 });
}

export async function onRequestPost(context) {
  if (!await requireAdministrator(context)) return unauthorized();
  const status = await callAuthCoordinator(context.env, 'mutationFreezeBegin', {
    audience: context.env.MIGRATION_AUDIENCE,
  });
  return Response.json(status, { headers: { 'Cache-Control': 'no-cache' } });
}

export async function onRequestDelete(context) {
  if (!await requireAdministrator(context)) return unauthorized();
  const status = await callAuthCoordinator(context.env, 'mutationFreezeStatus');
  const marker = await context.env.img_url.get(VISIBILITY_SCHEMA_KEY, { type: 'json' });
  const markerMatches = marker?.version === 1
    && marker?.complete === true
    && marker?.barrierGeneration === status.generation
    && marker?.audience === status.audience;
  if (!status.frozen || status.active !== 0 || !markerMatches) {
    return Response.json({ error: { code: 'VISIBILITY_MARKER_REQUIRED' } }, { status: 409 });
  }
  const unfrozen = await callAuthCoordinator(context.env, 'mutationFreezeEnd', {
    markerVerified: true, generation: status.generation,
  });
  return Response.json(unfrozen, { headers: { 'Cache-Control': 'no-cache' } });
}
