const assert = require('node:assert');

async function assertUnavailable(response) {
  assert.strictEqual(response.status, 503);
  const body = await response.json();
  assert.strictEqual(body.error.code, 'AUTH_STATE_UNAVAILABLE');
}

describe('authentication outage propagation', function () {
  it('returns machine-readable 503 from logout and passkey routes', async function () {
    const logout = await import('../functions/api/auth/logout.js');
    const options = await import('../functions/api/auth/passkey/auth/options.js');
    const logoutResponse = await logout.onRequestPost({
      request: new Request('https://vault.example/api/auth/logout', {
        method: 'POST', headers: { Cookie: 'seraph_pictures_session=current' },
      }),
      env: {},
    });
    const optionsResponse = await options.onRequestPost({
      request: new Request('https://vault.example/api/auth/passkey/auth/options', { method: 'POST' }),
      env: {},
    });

    await assertUnavailable(logoutResponse);
    await assertUnavailable(optionsResponse);
  });

  it('does not degrade coordinator outages into guest uploads', async function () {
    const direct = await import('../functions/upload.js');
    const remote = await import('../functions/api/upload-from-url.js');
    const form = new FormData();
    form.append('file', new File(['bytes'], 'image.png', { type: 'image/png' }));
    const directResponse = await direct.onRequestPost({
      request: new Request('https://vault.example/upload', { method: 'POST', body: form }),
      env: {},
    });
    const remoteResponse = await remote.onRequestPost({
      request: new Request('https://vault.example/api/upload-from-url', {
        method: 'POST', body: JSON.stringify({ url: 'https://example.com/image.png' }),
      }),
      env: {},
    });

    await assertUnavailable(directResponse);
    await assertUnavailable(remoteResponse);
  });

  it('preserves 503 through the manage middleware error boundary', async function () {
    const { onRequest } = await import('../functions/api/manage/_middleware.js');
    const base = {
      request: new Request('https://vault.example/api/manage/list'),
      env: { img_url: {} },
    };
    const authenticationContext = { ...base, next: async () => new Response('ok') };
    const response = await onRequest[0]({
      ...base,
      next: () => onRequest[1](authenticationContext),
    });

    await assertUnavailable(response);
  });

  it('preserves 503 across admin configuration and chunk-upload consumers', async function () {
    const admin = await import('../functions/api/admin/_middleware.js');
    const storage = await import('../functions/api/storage-config.js');
    const chunk = await import('../functions/api/chunked-upload/init.js');
    const env = { img_url: {} };
    const adminResponse = await admin.onRequest({
      request: new Request('https://vault.example/api/admin/files'), env,
      next: async () => new Response('ok'),
    });
    const storageResponse = await storage.onRequestGet({
      request: new Request('https://vault.example/api/storage-config'), env,
    });
    const chunkResponse = await chunk.onRequestPost({
      request: new Request('https://vault.example/api/chunked-upload/init', {
        method: 'POST', body: JSON.stringify({}),
      }),
      env,
    });

    await assertUnavailable(adminResponse);
    await assertUnavailable(storageResponse);
    await assertUnavailable(chunkResponse);
  });
});
