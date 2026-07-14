const assert = require('node:assert');

function coordinator(responses, operations) {
  return {
    idFromName() { return 'coordinator-id'; },
    get() { return { async fetch(request) {
      const operation = new URL(request.url).pathname.split('/').at(-1);
      operations.push(operation);
      return Response.json({ data: responses[operation] });
    } }; },
  };
}

describe('Pages mutation barrier middleware', function () {
  it('leases every mutating request and releases it after the handler', async function () {
    const operations = [];
    const middleware = await import('../functions/_middleware.js');
    const response = await middleware.onRequest({
      request: new Request('https://pictures.example/api/manage/edit', { method: 'PUT' }),
      env: { AUTH_COORDINATOR: coordinator({
        mutationEnter: { allowed: true, leaseId: 'lease-1', active: 1 },
        mutationExit: { released: true, active: 0 },
      }, operations) },
      next: async () => Response.json({ ok: true }),
    });

    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual(operations, ['mutationEnter', 'mutationExit']);
  });

  it('rejects new mutations while frozen without invoking the handler', async function () {
    let handled = false;
    const middleware = await import('../functions/_middleware.js');
    const response = await middleware.onRequest({
      request: new Request('https://pictures.example/upload', { method: 'POST' }),
      env: { AUTH_COORDINATOR: coordinator({
        mutationEnter: { allowed: false, leaseId: null, active: 0 },
      }, []) },
      next: async () => { handled = true; return Response.json({ ok: true }); },
    });

    assert.strictEqual(response.status, 503);
    assert.strictEqual((await response.json()).error.code, 'VISIBILITY_MIGRATION_FROZEN');
    assert.strictEqual(handled, false);
  });

  it('rejects an allowed mutation response that has no lease id', async function () {
    const middleware = await import('../functions/_middleware.js');
    const response = await middleware.onRequest({
      request: new Request('https://pictures.example/upload', { method: 'POST' }),
      env: { AUTH_COORDINATOR: coordinator({
        mutationEnter: { allowed: true, leaseId: null, active: 1 },
      }, []) },
      next: async () => Response.json({ ok: true }),
    });
    assert.strictEqual(response.status, 503);
    assert.strictEqual((await response.json()).error.code, 'AUTH_COORDINATOR_RESPONSE_INVALID');
  });

  it('does not lease read-only requests', async function () {
    const middleware = await import('../functions/_middleware.js');
    const response = await middleware.onRequest({
      request: new Request('https://pictures.example/api/status'),
      env: {},
      next: async () => Response.json({ status: 'ok' }),
    });

    assert.deepStrictEqual(await response.json(), { status: 'ok' });
  });

  it('returns the explicit authentication outage envelope when lease authority is missing', async function () {
    const middleware = await import('../functions/_middleware.js');
    const response = await middleware.onRequest({
      request: new Request('https://pictures.example/api/auth/login', { method: 'POST' }),
      env: {},
      next: async () => Response.json({ success: true }),
    });

    assert.strictEqual(response.status, 503);
    assert.deepStrictEqual(await response.json(), {
      success: false,
      message: '认证服务暂不可用',
      error: { code: 'AUTH_STATE_UNAVAILABLE' },
    });
  });

  it('keeps a GET lease until background metadata writes complete', async function () {
    const operations = [];
    let backgroundComplete = false;
    const middleware = await import('../functions/_middleware.js');
    const requestContext = {
      request: new Request('https://pictures.example/file/file-1'),
      env: { AUTH_COORDINATOR: coordinator({
        mutationEnter: { allowed: true, leaseId: 'lease-1', active: 1 },
        mutationExit: { released: true, active: 0 },
      }, operations) },
      next: async () => {
        requestContext.waitUntil(Promise.resolve().then(() => { backgroundComplete = true; }));
        return Response.json({ ok: true });
      },
    };

    await middleware.onRequest(requestContext);

    assert.strictEqual(backgroundComplete, true);
    assert.deepStrictEqual(operations, ['mutationEnter', 'mutationExit']);
  });

  it('exposes a no-cache freeze proof and refuses early unfreeze', async function () {
    const operations = [];
    const statusRoute = await import('../functions/api/migration-freeze.js');
    const adminRoute = await import('../functions/api/admin/migration-freeze.js');
    const env = {
      AUTH_COORDINATOR: coordinator({
        status: { initialized: true, schemaVersion: 1, legacyCleanupRequired: false },
        verifyCredentials: { ok: true },
        mutationFreezeStatus: {
          frozen: true, generation: 'generation-1', audience: 'namespace', active: 0,
        },
      }, operations),
      img_url: { async get() { return null; } },
    };

    const status = await statusRoute.onRequestGet({ env });
    const authorization = Buffer.from('admin:password').toString('base64');
    const unfreeze = await adminRoute.onRequestDelete({
      env,
      request: new Request('https://pictures.example/api/admin/migration-freeze', {
        method: 'DELETE', headers: { Authorization: `Basic ${authorization}` },
      }),
    });

    assert.deepStrictEqual(await status.json(), {
      frozen: true, generation: 'generation-1', audience: 'namespace', active: 0,
    });
    assert.strictEqual(status.headers.get('cache-control'), 'no-cache');
    assert.strictEqual(unfreeze.status, 409);
    assert.deepStrictEqual(operations, [
      'mutationFreezeStatus', 'status', 'verifyCredentials', 'mutationFreezeStatus',
    ]);
  });

  it('does not allow freeze control when authentication is disabled', async function () {
    const adminRoute = await import('../functions/api/admin/migration-freeze.js');
    const response = await adminRoute.onRequestPost({
      request: new Request('http://localhost/api/admin/migration-freeze', { method: 'POST' }),
      env: { AUTH_DISABLED: 'true', APP_ENV: 'local' },
    });

    assert.strictEqual(response.status, 401);
  });
});
