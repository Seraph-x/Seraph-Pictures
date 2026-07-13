const assert = require('node:assert');

function coordinator() {
  return {
    idFromName() { return 'coordinator-id'; },
    get() { return { async fetch(request) {
      const operation = new URL(request.url).pathname.split('/').at(-1);
      if (operation === 'status') {
        return Response.json({ data: {
          initialized: true, schemaVersion: 1, legacyCleanupRequired: false,
        } });
      }
      if (operation === 'configReadAuthority') {
        return Response.json({ data: {
          initialized: false, committedVersion: null, digest: null,
        } });
      }
      return Response.json({ error: { code: 'UNEXPECTED_PROBE' } }, { status: 500 });
    } }; },
  };
}

describe('status route boundaries', function () {
  it('returns the exact minimal Cloudflare body without storage probes', async function () {
    let probes = 0;
    const route = await import('../functions/api/status.js');
    const response = await route.onRequestGet({
      request: new Request('https://vault.example/api/status'),
      env: {
        AUTH_COORDINATOR: coordinator(),
        img_url: {
          async list() { probes += 1; throw new Error('probe called'); },
          async get() { probes += 1; throw new Error('probe called'); },
        },
        R2_BUCKET: { async list() { probes += 1; throw new Error('probe called'); } },
      },
    });

    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual(await response.json(), { status: 'ok' });
    assert.strictEqual(probes, 0);
  });

  it('allows an explicit local administrator to run bounded probes', async function () {
    let probes = 0;
    const route = await import('../functions/api/status.js');
    const response = await route.onRequestGet({
      request: new Request('http://localhost/api/status'),
      env: {
        AUTH_DISABLED: 'true',
        APP_ENV: 'local',
        AUTH_COORDINATOR: coordinator(),
        img_url: {
          async get() { return null; },
          async put() {},
          async list() { probes += 1; return { keys: [] }; },
        },
      },
    });
    const body = await response.json();

    assert.strictEqual(body.kv.connected, true);
    assert.strictEqual(probes, 1);
  });
});
