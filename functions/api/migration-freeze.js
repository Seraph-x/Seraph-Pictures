import { callAuthCoordinator } from '../utils/auth/coordinator-client.js';

export async function onRequestGet(context) {
  const status = await callAuthCoordinator(context.env, 'mutationFreezeStatus');
  return Response.json(status, {
    headers: { 'Cache-Control': 'no-cache' },
  });
}
