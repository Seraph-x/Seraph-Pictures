const assert = require('assert');
const fs = require('node:fs');
const path = require('node:path');
const { createApp } = require('../server/app');
const { selectProbeConfigs } = require('../server/lib/services/status-service');
const { testStatusConnection } = require('../server/lib/services/status-connection');

describe('Server status storage semantics', function () {
  this.timeout(10000);

  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;
  let tmpDir;

  beforeEach(function () {
    tmpDir = path.join(__dirname, '..', 'data', `tmp-status-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    fs.mkdirSync(tmpDir, { recursive: true });

    process.env.CONFIG_ENCRYPTION_KEY = 'status_test_key_123456';
    process.env.SESSION_SECRET = 'status_test_secret_123456';
    process.env.DATA_DIR = tmpDir;
    process.env.DB_PATH = path.join(tmpDir, 'status-test.db');
    process.env.BASIC_USER = 'status-admin';
    process.env.BASIC_PASS = 'status-password';
    process.env.TG_BOT_TOKEN = '';
    process.env.TG_CHAT_ID = '';
    process.env.HF_TOKEN = '';
    process.env.HF_REPO = '';
    process.env.HUGGINGFACE_TOKEN = '';
    process.env.HUGGINGFACE_REPO = '';
    process.env.HF_API_TOKEN = '';
    process.env.HF_DATASET_REPO = '';

    process.env.GITHUB_TOKEN = 'bad_token';
    process.env.GITHUB_REPO = 'owner/repo';
    process.env.GH_TOKEN = '';
    process.env.GITHUB_PAT = '';
    process.env.GH_REPO = '';
    process.env.GITHUB_REPOSITORY = '';

    global.fetch = async () => new Response(
      JSON.stringify({ message: 'Bad credentials' }),
      {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }
    );

    process.env.SETTINGS_STORE = 'sqlite';
    process.env.SETTINGS_REDIS_URL = '';
  });

  afterEach(function () {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    for (const [key, value] of Object.entries(originalEnv)) {
      process.env[key] = value;
    }

    global.fetch = originalFetch;

    // Some SQLite handles can still be held briefly by the runtime container.
    // Keep temp files to avoid flaky EBUSY on Windows CI/dev boxes.
  });

  it('keeps enabled=true when storage is configured but connection fails', async function () {
    const app = createApp();

    const authorization = Buffer.from('status-admin:status-password').toString('base64');
    const statusResponse = await app.fetch(new Request('http://localhost/api/status', {
      headers: { Authorization: `Basic ${authorization}` },
    }));
    assert.strictEqual(statusResponse.status, 200);

    const status = await statusResponse.json();
    assert.ok(status.github);
    assert.strictEqual(status.github.configured, true);
    assert.strictEqual(status.github.connected, false);
    assert.strictEqual(status.github.enabled, true);
  });

  it('returns only minimal status to anonymous callers without adapter probes', async function () {
    let probes = 0;
    global.fetch = async () => { probes += 1; throw new Error('probe called'); };
    const app = createApp();
    const response = await app.fetch(new Request('http://localhost/api/status'));

    assert.deepStrictEqual(await response.json(), { status: 'ok' });
    assert.strictEqual(response.headers.get('cache-control'), 'no-cache');
    assert.strictEqual(probes, 0);
  });

  it('does not expose diagnostics when authentication is disabled in production', async function () {
    process.env.NODE_ENV = 'production';
    process.env.AUTH_DISABLED = 'true';
    process.env.FILE_SHARE_SECRET_CURRENT = 'status_share_secret_12345678901234567890';
    let probes = 0;
    global.fetch = async () => { probes += 1; throw new Error('probe called'); };

    const app = createApp();
    const response = await app.fetch(new Request('https://pictures.example/api/status'));

    assert.deepStrictEqual(await response.json(), { status: 'ok' });
    assert.strictEqual(probes, 0);
  });

  it('selects every supported storage profile for independent bounded probes', function () {
    const configs = [
      { id: 'disabled', type: 'github', enabled: false, isDefault: true },
      { id: 'enabled', type: 'github', enabled: true, isDefault: false },
      { id: 'unknown', type: 'custom', enabled: true, isDefault: true },
      { id: 'telegram', type: 'telegram', enabled: true, isDefault: false },
    ];

    assert.deepStrictEqual(
      selectProbeConfigs(configs).map((config) => config.id),
      ['disabled', 'enabled', 'telegram'],
    );
  });

  it('passes cancellation into direct GitHub status probes', async function () {
    const controller = new AbortController();
    let receivedSignal;
    global.fetch = async (url, options) => {
      receivedSignal = options.signal;
      return new Response('{}', { status: 200 });
    };
    const adapter = {
      config: { mode: 'contents' },
      validate() {},
      repoApi() { return 'https://api.github.test/repos/owner/repo'; },
      authHeaders() { return { Authorization: 'Bearer token' }; },
    };

    await testStatusConnection({
      type: 'github', adapter, signal: controller.signal,
    });

    assert.strictEqual(receivedSignal, controller.signal);
  });
});
