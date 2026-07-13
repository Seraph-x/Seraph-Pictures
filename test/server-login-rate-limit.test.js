const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { initDatabase } = require('../server/db');

function createDatabase() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seraph-login-limit-'));
  const db = initDatabase(path.join(root, 'test.db'));
  return { root, db };
}

function cleanupDatabase(fixture) {
  fixture.db.close();
  fs.rmSync(fixture.root, { recursive: true, force: true });
}

describe('Docker login rate limiting', function () {
  const originalEnv = { ...process.env };

  afterEach(function () {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key];
    }
    for (const [key, value] of Object.entries(originalEnv)) process.env[key] = value;
  });

  it('prefers proxy-controlled client IP headers over forwarded input', function () {
    const { getClientIp } = require('../server/lib/utils/client-ip');
    const request = new Request('http://localhost', {
      headers: {
        'X-Forwarded-For': '198.51.100.1, 203.0.113.20',
        'X-Real-IP': '203.0.113.20',
      },
    });

    assert.strictEqual(getClientIp(request), '203.0.113.20');
  });

  it('blocks subsequent attempts after five failures and resets after expiry', function () {
    const { LoginRateLimitService } = require('../server/lib/services/login-rate-limit-service');
    const fixture = createDatabase();
    let now = 1_000_000;
    try {
      const limiter = new LoginRateLimitService({ db: fixture.db, now: () => now });
      for (let count = 1; count <= 5; count += 1) {
        assert.strictEqual(limiter.recordFailure('203.0.113.8').count, count);
      }
      assert.strictEqual(limiter.check('203.0.113.8').blocked, true);
      now += (15 * 60 * 1000) + 1;
      assert.deepStrictEqual(limiter.check('203.0.113.8'), { blocked: false, retryAfter: 0 });
    } finally {
      cleanupDatabase(fixture);
    }
  });

  it('clears failures after a successful login', function () {
    const { LoginRateLimitService } = require('../server/lib/services/login-rate-limit-service');
    const fixture = createDatabase();
    try {
      const limiter = new LoginRateLimitService({ db: fixture.db });
      limiter.recordFailure('203.0.113.9');
      limiter.clear('203.0.113.9');
      assert.deepStrictEqual(limiter.check('203.0.113.9'), { blocked: false, retryAfter: 0 });
    } finally {
      cleanupDatabase(fixture);
    }
  });

  it('returns 429 with Retry-After after repeated route failures', async function () {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seraph-login-route-'));
    process.env.NODE_ENV = 'development';
    process.env.DATA_DIR = root;
    process.env.DB_PATH = path.join(root, 'route.db');
    process.env.BASIC_USER = 'admin';
    process.env.BASIC_PASS = 'valid-password';
    process.env.AUTH_DISABLED = 'false';
    const { createApp } = require('../server/app');
    const app = createApp();
    const request = () => new Request('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.10' },
      body: JSON.stringify({ username: 'admin', password: 'wrong' }),
    });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      assert.strictEqual((await app.fetch(request())).status, 401);
    }
    const blocked = await app.fetch(request());
    assert.strictEqual(blocked.status, 429);
    assert.strictEqual(blocked.headers.get('Retry-After'), '900');
  });
});
