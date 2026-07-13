const assert = require('node:assert');

function createNamespace(handler) {
  return {
    idFromName(name) {
      assert.strictEqual(name, 'admin-auth');
      return 'singleton-id';
    },
    get(id) {
      assert.strictEqual(id, 'singleton-id');
      return {
        async fetch(request) {
          const operation = new URL(request.url).pathname.split('/').at(-1);
          const payload = await request.json();
          const result = await handler(operation, payload);
          return new Response(JSON.stringify({ data: result }), {
            headers: { 'Content-Type': 'application/json' },
          });
        },
      };
    },
  };
}

function createKv() {
  return {
    async get() { return null; },
    async put() {},
    async delete() {},
  };
}

describe('Cloudflare auth coordinator bridge', function () {
  it('fails closed with 503 semantics when the binding is absent', async function () {
    const { checkAuthentication } = await import('../functions/utils/auth.js');

    await assert.rejects(
      checkAuthentication({ request: new Request('https://vault.example/api/auth/check'), env: {} }),
      (error) => error.code === 'AUTH_STATE_UNAVAILABLE' && error.status === 503
    );
  });

  it('verifies credentials through the coordinator without reading KV or env password', async function () {
    const { verifyCredentials } = await import('../functions/utils/auth.js');
    const calls = [];
    const env = {
      BASIC_PASS: 'must-not-be-read',
      img_url: { get: () => { throw new Error('KV must not be read'); } },
      AUTH_COORDINATOR: createNamespace((operation, payload) => {
        calls.push({ operation, payload });
        return { ok: true, credVersion: 7 };
      }),
    };

    assert.deepStrictEqual(await verifyCredentials('owner', 'password', env), {
      ok: true,
      credVersion: 7,
    });
    assert.deepStrictEqual(calls, [{
      operation: 'verifyCredentials',
      payload: { username: 'owner', password: 'password' },
    }]);
  });

  it('checks cookie and Basic auth through coordinator operations', async function () {
    const { checkAuthentication } = await import('../functions/utils/auth.js');
    const operations = [];
    const env = {
      AUTH_COORDINATOR: createNamespace((operation) => {
        operations.push(operation);
        if (operation === 'verifySession') return false;
        return { ok: true, credVersion: 2 };
      }),
    };
    const basic = btoa('admin:password');
    const request = new Request('https://vault.example/api/manage/list', {
      headers: {
        Cookie: 'seraph_pictures_session=old-token',
        Authorization: `Basic ${basic}`,
      },
    });

    assert.deepStrictEqual(await checkAuthentication({ request, env }), {
      authenticated: true,
      reason: 'basic-auth',
      user: 'admin',
    });
    assert.deepStrictEqual(operations, ['status', 'verifySession', 'verifyCredentials']);
  });

  it('rejects AUTH_DISABLED in production and allows only explicit local mode', async function () {
    const { isAuthRequired } = await import('../functions/utils/auth.js');

    assert.throws(
      () => isAuthRequired({ AUTH_DISABLED: 'true' }),
      (error) => error.code === 'INSECURE_PRODUCTION_CONFIG'
    );
    assert.strictEqual(isAuthRequired({ AUTH_DISABLED: 'true', APP_ENV: 'local' }), false);
  });

  it('logs in with the coordinator-issued session and no KV credential write', async function () {
    const { onRequestPost } = await import('../functions/api/auth/login.js');
    const operations = [];
    const response = await onRequestPost({
      request: new Request('https://vault.example/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username: 'admin', password: 'password' }),
      }),
      env: {
        BASIC_USER: 'admin',
        BASIC_PASS: 'password',
        img_url: createKv(),
        AUTH_COORDINATOR: createNamespace((operation, payload) => {
          operations.push({ operation, payload });
          if (operation === 'status') return { initialized: false, schemaVersion: 1 };
          return { ok: true, session: { token: 'new-session' } };
        }),
      },
    });

    assert.strictEqual(response.status, 200);
    assert.match(response.headers.get('set-cookie'), /seraph_pictures_session=new-session/);
    assert.deepStrictEqual(operations, [
      { operation: 'status', payload: {} },
      {
        operation: 'bootstrapLogin',
        payload: { username: 'admin', password: 'password', bootstrapAuthorized: true },
      },
    ]);
  });

  it('does not invoke bootstrap when uninitialized credentials miss the env seed', async function () {
    const { loginWithCredentials } = await import('../functions/utils/auth.js');
    const operations = [];
    const env = {
      BASIC_USER: 'admin',
      BASIC_PASS: 'seed-password',
      AUTH_COORDINATOR: createNamespace((operation) => {
        operations.push(operation);
        return { initialized: false, schemaVersion: 1 };
      }),
    };

    assert.deepStrictEqual(await loginWithCredentials('attacker', 'wrong', env), {
      ok: false,
      code: 'INVALID_CREDENTIALS',
    });
    assert.deepStrictEqual(operations, ['status']);
  });

  it('maps missing coordinator binding to an explicit 503 auth check', async function () {
    const { onRequestGet } = await import('../functions/api/auth/check.js');
    const response = await onRequestGet({
      request: new Request('https://vault.example/api/auth/check'),
      env: { img_url: createKv() },
    });

    assert.strictEqual(response.status, 503);
    assert.deepStrictEqual(await response.json(), {
      authenticated: false,
      authRequired: true,
      error: { code: 'AUTH_STATE_UNAVAILABLE' },
    });
  });

  it('changes credentials atomically and sets the replacement session', async function () {
    const { onRequestPost } = await import('../functions/api/auth/credentials.js');
    const operations = [];
    const responses = {
      status: { initialized: true, schemaVersion: 1 },
      verifySession: true,
      readProfile: { initialized: true, username: 'admin', credVersion: 1 },
      verifyCredentials: { ok: true, credVersion: 1 },
      changeCredentials: { ok: true, session: { token: 'replacement' } },
    };
    const response = await onRequestPost({
      request: new Request('https://vault.example/api/auth/credentials', {
        method: 'POST',
        headers: { Cookie: 'seraph_pictures_session=current' },
        body: JSON.stringify({ currentPassword: 'old-pass', newPassword: 'new-pass' }),
      }),
      env: {
        AUTH_COORDINATOR: createNamespace((operation, payload) => {
          operations.push({ operation, payload });
          return responses[operation];
        }),
      },
    });

    assert.strictEqual(response.status, 200);
    assert.match(response.headers.get('set-cookie'), /replacement/);
    assert.deepStrictEqual(operations.at(-1), {
      operation: 'changeCredentials',
      payload: { sessionToken: 'current', username: 'admin', password: 'new-pass' },
    });
  });

  it('logs out through the coordinator and clears all session cookies', async function () {
    const { onRequestPost } = await import('../functions/api/auth/logout.js');
    const operations = [];
    const response = await onRequestPost({
      request: new Request('https://vault.example/api/auth/logout', {
        method: 'POST',
        headers: { Cookie: 'seraph_pictures_session=current' },
      }),
      env: {
        AUTH_COORDINATOR: createNamespace((operation, payload) => {
          operations.push({ operation, payload });
          return { ok: true };
        }),
      },
    });

    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual(operations, [{ operation: 'logout', payload: { token: 'current' } }]);
    assert.match(response.headers.get('set-cookie'), /Max-Age=0/);
  });
});
