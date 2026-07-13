const assert = require('node:assert');
const { loadConfig } = require('../server/lib/config');

const SECURE_ENV = Object.freeze({
  NODE_ENV: 'production',
  BASIC_USER: 'admin',
  BASIC_PASS: 'correct-horse-battery-staple',
  CONFIG_ENCRYPTION_KEY: 'config-key-0123456789abcdef0123456789abcdef',
  SESSION_SECRET: 'session-key-0123456789abcdef0123456789abcdef',
});

function assertInsecure(env, variables) {
  assert.throws(
    () => loadConfig({ ...SECURE_ENV, ...env }),
    (error) => (
      error?.code === 'INSECURE_PRODUCTION_CONFIG'
      && variables.every((name) => error.message.includes(name))
    )
  );
}

describe('Docker production configuration validation', function () {
  it('rejects empty production credentials', function () {
    assertInsecure({ BASIC_USER: '', BASIC_PASS: '' }, ['BASIC_USER', 'BASIC_PASS']);
  });

  it('rejects example passwords and encryption keys', function () {
    assertInsecure(
      {
        BASIC_PASS: 'change_this_password',
        CONFIG_ENCRYPTION_KEY: 'replace_with_a_long_random_secret',
      },
      ['BASIC_PASS', 'CONFIG_ENCRYPTION_KEY']
    );
  });

  it('accepts explicit secure production credentials', function () {
    const config = loadConfig(SECURE_ENV);

    assert.strictEqual(config.authDisabled, false);
    assert.strictEqual(config.basicUser, 'admin');
  });

  it('allows explicitly disabled authentication with secure encryption keys', function () {
    const config = loadConfig({
      ...SECURE_ENV,
      AUTH_DISABLED: 'true',
      BASIC_USER: '',
      BASIC_PASS: '',
    });

    assert.strictEqual(config.authDisabled, true);
  });
});
