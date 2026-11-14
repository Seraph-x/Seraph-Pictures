const assert = require('node:assert/strict');

describe('retired Vue route', function () {
  it('serves the 404 document instead of looking up a cached Vue page', async function () {
    const { onRequest } = await import('../functions/app/[[path]].js');
    const calls = [];
    const env = { ASSETS: { async fetch(request) {
      calls.push(new URL(request.url).pathname);
      return new Response('页面不存在', { headers: { 'Content-Type': 'text/html', 'Cache-Control': 'public, max-age=3600' } });
    } } };
    for (const method of ['GET', 'HEAD']) {
      const response = await onRequest({ env, request: new Request('https://example.test/app/login', { method }) });
      assert.equal(response.status, 404);
      assert.equal(response.headers.get('Cache-Control'), 'no-store');
      assert.equal(await response.text(), method === 'HEAD' ? '' : '页面不存在');
    }
    assert.deepEqual(calls, ['/404', '/404']);
  });

  it('exposes a missing or failed 404 asset instead of masking it', async function () {
    const { onRequest } = await import('../functions/app/[[path]].js');
    const env = { ASSETS: { async fetch() { return new Response('asset failed', { status: 503 }); } } };
    await assert.rejects(onRequest({ env, request: new Request('https://example.test/app/login') }), /RETIRED_PAGE_ASSET_FAILED:503/);
  });
});
