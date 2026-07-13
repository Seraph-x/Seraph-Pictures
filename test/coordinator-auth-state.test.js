const assert = require('node:assert');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const SERVICE_URL = pathToFileURL(
  path.resolve(__dirname, '../workers/coordinator/src/auth/auth-service.js')
).href;

class MemoryAuthRepository {
  constructor() {
    this.state = null;
    this.sessions = new Map();
    this.queue = Promise.resolve();
  }

  transaction(operation) {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => undefined);
    return result;
  }

  readAuthState() { return this.state; }
  initializeAuth(state) { this.state = Object.freeze({ ...state }); }
  updateAuth(state) { this.state = Object.freeze({ ...state }); }
  readSession(token) { return this.sessions.get(token) || null; }
  writeSession(session) { this.sessions.set(session.token, Object.freeze({ ...session })); }
  deleteSession(token) { this.sessions.delete(token); }
  deleteAllSessions() { this.sessions.clear(); }
}

function createHarness() {
  const repository = new MemoryAuthRepository();
  let tokenSequence = 0;
  const dependencies = {
    repository,
    clock: { now: () => 1_700_000_000_000 },
    tokens: { create: () => `token-${++tokenSequence}` },
    bootstrapCredentials: {
      verify: ({ username, password }) => username === 'admin' && password === 'first',
    },
    passwords: {
      createRecord: async ({ username, password, credVersion }) => Object.freeze({
        username,
        passwordHash: `hash:${password}`,
        salt: 'salt',
        iterations: 1,
        credVersion,
      }),
      verify: async ({ password }, record) => record.passwordHash === `hash:${password}`,
    },
  };
  return { repository, dependencies };
}

describe('auth coordinator state service', function () {
  it('initializes exactly once under concurrent bootstrap login', async function () {
    const { AuthService } = await import(SERVICE_URL);
    const { repository, dependencies } = createHarness();
    const service = new AuthService(dependencies);

    const results = await Promise.all([
      service.bootstrapLogin({ username: 'admin', password: 'first' }),
      service.bootstrapLogin({ username: 'admin', password: 'second' }),
    ]);

    assert.strictEqual(results.filter((item) => item.ok).length, 1);
    assert.strictEqual(repository.readAuthState().initialized, true);
    assert.strictEqual(repository.readAuthState().credVersion, 1);
  });

  it('logs in against initialized state without consulting bootstrap credentials', async function () {
    const { AuthService } = await import(SERVICE_URL);
    const { dependencies } = createHarness();
    let bootstrapChecks = 0;
    dependencies.bootstrapCredentials.verify = (input) => {
      bootstrapChecks += 1;
      return input.password === 'first';
    };
    const service = new AuthService(dependencies);
    await service.bootstrapLogin({ username: 'admin', password: 'first' });

    assert.strictEqual((await service.bootstrapLogin({ username: 'admin', password: 'wrong' })).ok, false);
    assert.strictEqual((await service.bootstrapLogin({ username: 'admin', password: 'first' })).ok, true);
    assert.strictEqual(bootstrapChecks, 1);
  });

  it('invalidates the old session immediately after credential change', async function () {
    const { AuthService } = await import(SERVICE_URL);
    const { dependencies } = createHarness();
    const service = new AuthService(dependencies);
    const login = await service.bootstrapLogin({ username: 'admin', password: 'first' });

    const changed = await service.changeCredentials({
      sessionToken: login.session.token,
      username: 'owner',
      password: 'second-password',
    });

    assert.strictEqual(changed.ok, true);
    assert.strictEqual(await service.verifySession({ token: login.session.token }), false);
    assert.strictEqual(await service.verifySession({ token: changed.session.token }), true);
    assert.strictEqual((await service.bootstrapLogin({ username: 'owner', password: 'second-password' })).ok, true);
  });

  it('deletes sessions on logout and exposes only minimal status', async function () {
    const { AuthService } = await import(SERVICE_URL);
    const { dependencies } = createHarness();
    const service = new AuthService(dependencies);
    assert.deepStrictEqual(service.status(), { initialized: false, schemaVersion: 1 });
    const login = await service.bootstrapLogin({ username: 'admin', password: 'first' });

    await service.logout({ token: login.session.token });

    assert.strictEqual(await service.verifySession({ token: login.session.token }), false);
    assert.deepStrictEqual(service.status(), { initialized: true, schemaVersion: 1 });
  });

  it('verifies credentials and issues trusted sessions without exposing password state', async function () {
    const { AuthService } = await import(SERVICE_URL);
    const { dependencies } = createHarness();
    const service = new AuthService(dependencies);
    await service.bootstrapLogin({ username: 'admin', password: 'first' });

    assert.deepStrictEqual(
      await service.verifyCredentials({ username: 'admin', password: 'first' }),
      { ok: true, credVersion: 1 }
    );
    assert.deepStrictEqual(await service.getProfile({ token: 'missing' }), { ok: false, code: 'SESSION_INVALID' });
    const trusted = await service.issueSession({ username: 'admin' });
    assert.strictEqual(await service.verifySession({ token: trusted.session.token }), true);
    assert.deepStrictEqual(await service.getProfile({ token: trusted.session.token }), {
      ok: true,
      username: 'admin',
      credVersion: 1,
    });
  });
});
