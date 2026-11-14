// Retired paths must bypass cached Vue entrypoints in the static asset service.
export async function onRequest({ request, env }) {
  const document = await env.ASSETS.fetch(new Request(new URL('/404', request.url)));
  if (document.status !== 200) {
    throw new Error(`RETIRED_PAGE_ASSET_FAILED:${document.status}`);
  }
  const headers = new Headers(document.headers);
  headers.set('Cache-Control', 'no-store');
  return new Response(request.method === 'HEAD' ? null : document.body, {
    status: 404,
    headers,
  });
}
