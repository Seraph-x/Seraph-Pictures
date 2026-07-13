import { checkAuthentication, isAuthRequired } from '../utils/auth.js';
import { collectCloudflareStatus } from '../services/status-probes.js';
import statusPolicy from '../../shared/security/status-policy.cjs';

const { STATUS_ACTORS, decideStatusAccess } = statusPolicy;

function json(body) {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
  });
}

async function statusActor(context) {
  if (!isAuthRequired(context.env)) {
    const explicitLocalMode = context.env.APP_ENV === 'local'
      && String(context.env.AUTH_DISABLED).trim().toLowerCase() === 'true';
    return explicitLocalMode ? STATUS_ACTORS.ADMIN : STATUS_ACTORS.ANONYMOUS;
  }
  const authentication = await checkAuthentication(context);
  return authentication.authenticated ? STATUS_ACTORS.ADMIN : STATUS_ACTORS.ANONYMOUS;
}

export async function onRequestGet(context) {
  const decision = decideStatusAccess({ actor: await statusActor(context) });
  if (!decision.runProbes) return json(decision.body);
  return json(await collectCloudflareStatus({ env: context.env }));
}
