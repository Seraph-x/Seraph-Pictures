const assert = require('node:assert');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const MODULE_URL = pathToFileURL(
  path.resolve(__dirname, '../scripts/probe-coordinator-binding.mjs')
).href;

describe('coordinator binding probe', function () {
  it('accepts only a successful fail-closed auth check envelope', async function () {
    const { probeCoordinatorBinding } = await import(MODULE_URL);
    const fetchImpl = async (url) => {
      assert.strictEqual(url, 'https://preview.example/api/auth/check');
      return new Response(JSON.stringify({ authenticated: false, authRequired: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    assert.deepStrictEqual(
      await probeCoordinatorBinding({ baseUrl: 'https://preview.example', fetchImpl }),
      { binding: 'ok' }
    );
  });

  it('surfaces coordinator and response schema failures', async function () {
    const { probeCoordinatorBinding } = await import(MODULE_URL);
    const unavailable = async () => new Response(JSON.stringify({
      authenticated: false,
      authRequired: true,
      error: { code: 'AUTH_STATE_UNAVAILABLE' },
    }), { status: 503 });
    const invalid = async () => new Response('{}', { status: 200 });

    await assert.rejects(
      probeCoordinatorBinding({ baseUrl: 'https://preview.example', fetchImpl: unavailable }),
      /COORDINATOR_BINDING_PROBE_FAILED:503/
    );
    await assert.rejects(
      probeCoordinatorBinding({ baseUrl: 'https://preview.example', fetchImpl: invalid }),
      /COORDINATOR_BINDING_PROBE_SCHEMA_INVALID/
    );
  });
});
