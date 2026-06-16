const assert = require('assert');

function makeKv() {
  const store = new Map();
  return {
    store,
    async get(key, opts) {
      const raw = store.has(key) ? store.get(key) : null;
      if (raw == null) return null;
      if (opts && opts.type === 'json') return JSON.parse(raw);
      return raw;
    },
    async put(key, value) { store.set(key, value); },
    async delete(key) { store.delete(key); },
  };
}

describe('storage-config (KV-backed runtime storage settings)', function () {
  it('writes then reads back, masking secrets but exposing presence', async function () {
    const mod = await import('../functions/utils/storage-config.js');
    const env = { img_url: makeKv(), CONFIG_ENCRYPTION_KEY: 'test-key-123' };

    await mod.writeStorageConfig(env, {
      webdav: { baseUrl: 'https://dav.example/remote.php', username: 'alice', password: 's3cret' },
    });

    const { config, secretsPresent } = await mod.readStorageConfig(env);
    assert.strictEqual(config.webdav.baseUrl, 'https://dav.example/remote.php');
    assert.strictEqual(config.webdav.username, 'alice');
    assert.strictEqual(config.webdav.password, '', 'secret must never be returned in plaintext');
    assert.strictEqual(secretsPresent.webdav.password, true, 'presence flag should signal a stored secret');
  });

  it('encrypts secret fields at rest in KV (no plaintext)', async function () {
    const mod = await import('../functions/utils/storage-config.js');
    const kv = makeKv();
    const env = { img_url: kv, CONFIG_ENCRYPTION_KEY: 'test-key-123' };

    await mod.writeStorageConfig(env, { webdav: { password: 'plain-secret' } });

    const stored = JSON.parse(kv.store.get('storage_config'));
    assert.ok(stored.webdav.password.startsWith('enc:v1:'), 'secret should be AES-GCM encrypted');
    assert.ok(!stored.webdav.password.includes('plain-secret'), 'plaintext secret must not appear in KV');
  });

  it('resolveStorageEnv overlays KV values onto env (KV wins), decrypting secrets', async function () {
    const mod = await import('../functions/utils/storage-config.js');
    const env = { img_url: makeKv(), CONFIG_ENCRYPTION_KEY: 'test-key-123', WEBDAV_BASE_URL: 'https://from-env' };

    await mod.writeStorageConfig(env, {
      webdav: { baseUrl: 'https://from-kv', password: 'pw-kv' },
    });

    const senv = await mod.resolveStorageEnv(env);
    assert.strictEqual(senv.WEBDAV_BASE_URL, 'https://from-kv', 'KV value should win over env');
    assert.strictEqual(senv.WEBDAV_PASSWORD, 'pw-kv', 'secret should be decrypted into the overlay');
  });

  it('maps telegram main and guest channels to distinct env vars', async function () {
    const mod = await import('../functions/utils/storage-config.js');
    const env = { img_url: makeKv(), CONFIG_ENCRYPTION_KEY: 'test-key-123' };

    await mod.writeStorageConfig(env, {
      telegram: { botToken: 'main-token', chatId: '111' },
      telegramGuest: { botToken: 'guest-token', chatId: '222' },
    });

    const senv = await mod.resolveStorageEnv(env);
    assert.strictEqual(senv.TG_Bot_Token, 'main-token');
    assert.strictEqual(senv.TG_Chat_ID, '111');
    assert.strictEqual(senv.TG_GUEST_BOT_TOKEN, 'guest-token');
    assert.strictEqual(senv.TG_GUEST_CHAT_ID, '222');
  });

  it('preserves an existing secret when the patch leaves it blank', async function () {
    const mod = await import('../functions/utils/storage-config.js');
    const env = { img_url: makeKv(), CONFIG_ENCRYPTION_KEY: 'test-key-123' };

    await mod.writeStorageConfig(env, { webdav: { baseUrl: 'https://x', password: 'keep-me' } });
    await mod.writeStorageConfig(env, { webdav: { baseUrl: 'https://y', password: '' } });

    const senv = await mod.resolveStorageEnv(env);
    assert.strictEqual(senv.WEBDAV_BASE_URL, 'https://y', 'non-secret update should apply');
    assert.strictEqual(senv.WEBDAV_PASSWORD, 'keep-me', 'blank secret should preserve prior value');
  });

  it('returns env unchanged when no config is stored', async function () {
    const mod = await import('../functions/utils/storage-config.js');
    const env = { img_url: makeKv(), CONFIG_ENCRYPTION_KEY: 'test-key-123', WEBDAV_BASE_URL: 'https://env-only' };
    const senv = await mod.resolveStorageEnv(env);
    assert.strictEqual(senv.WEBDAV_BASE_URL, 'https://env-only');
  });

  it('refuses to save a secret when no encryption key is configured', async function () {
    const mod = await import('../functions/utils/storage-config.js');
    const env = { img_url: makeKv() }; // no CONFIG_ENCRYPTION_KEY / SESSION_SECRET
    await assert.rejects(
      () => mod.writeStorageConfig(env, { webdav: { password: 'x' } }),
      (err) => err && err.code === 'NO_ENC_KEY'
    );
  });

  it('describeStorageSchema exposes types, fields and guest metadata without secrets', async function () {
    const mod = await import('../functions/utils/storage-config.js');
    const schema = mod.describeStorageSchema();
    const telegram = schema.find((s) => s.type === 'telegram');
    const telegramGuest = schema.find((s) => s.type === 'telegramGuest');
    assert.ok(telegram && telegram.fields.some((f) => f.key === 'botToken' && f.secret === true));
    assert.ok(telegramGuest && telegramGuest.guest === true && telegramGuest.group === 'telegram');
    assert.ok(schema.every((s) => s.fields.every((f) => !('env' in f))), 'descriptor must not leak env var names');
  });
});
