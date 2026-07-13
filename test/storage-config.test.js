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

function makeCoordinator({ failFirstCommit = false } = {}) {
  const state = { committedVersion: null, digest: null, pending: null, commitAttempts: 0 };
  const stub = {
    async fetch(request) {
      const operation = new URL(request.url).pathname.split('/').at(-1);
      const payload = await request.json();
      if (operation === 'configReadAuthority') {
        return Response.json({ data: {
          initialized: state.committedVersion !== null,
          committedVersion: state.committedVersion,
          digest: state.digest,
        } });
      }
      if (operation === 'configBegin') {
        state.pending = { version: (state.committedVersion || 0) + 1, digest: payload.digest };
        return Response.json({ data: { ok: true, version: state.pending.version } });
      }
      if (operation === 'configCommit') {
        state.commitAttempts += 1;
        if (failFirstCommit && state.commitAttempts === 1) {
          return Response.json({ error: { code: 'AUTH_STATE_UNAVAILABLE' } }, { status: 503 });
        }
        state.committedVersion = payload.version;
        state.digest = payload.digest;
        state.pending = null;
        return Response.json({ data: { ok: true, committedVersion: payload.version } });
      }
      if (operation === 'configAbort') {
        state.pending = null;
        return Response.json({ data: { aborted: true } });
      }
      return Response.json({ error: { code: 'UNKNOWN' } }, { status: 404 });
    },
  };
  return {
    state,
    idFromName: () => 'coordinator-id',
    get: () => stub,
  };
}

function makeEnv(overrides = {}) {
  return {
    img_url: makeKv(),
    AUTH_COORDINATOR: makeCoordinator(),
    CONFIG_ENCRYPTION_KEY: 'test-key-123',
    ...overrides,
  };
}

describe('storage-config (KV-backed runtime storage settings)', function () {
  it('writes then reads back, masking secrets but exposing presence', async function () {
    const mod = await import('../functions/utils/storage-config.js');
    const env = makeEnv();

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
    const env = makeEnv({ img_url: kv });

    await mod.writeStorageConfig(env, { webdav: { password: 'plain-secret' } });

    const stored = JSON.parse(kv.store.get('storage_config:v1'));
    assert.ok(stored.config.webdav.password.startsWith('enc:v1:'), 'secret should be AES-GCM encrypted');
    assert.ok(!stored.config.webdav.password.includes('plain-secret'), 'plaintext secret must not appear in KV');
  });

  it('snapshots existing environment storage values into the first committed version', async function () {
    const mod = await import('../functions/utils/storage-config.js');
    const kv = makeKv();
    const env = makeEnv({
      img_url: kv,
      WEBDAV_PASSWORD: 'environment-password',
      TG_Chat_ID: 'environment-chat',
    });

    await mod.writeStorageConfig(env, { webdav: { baseUrl: 'https://saved.example' } });
    const stored = JSON.parse(kv.store.get('storage_config:v1'));

    assert.match(stored.config.webdav.password, /^enc:v1:/);
    assert.strictEqual(stored.config.telegram.chatId, 'environment-chat');
    assert.strictEqual(JSON.stringify(stored).includes('environment-password'), false);
  });

  it('resolveStorageEnv overlays KV values onto env (KV wins), decrypting secrets', async function () {
    const mod = await import('../functions/utils/storage-config.js');
    const env = makeEnv({ WEBDAV_BASE_URL: 'https://from-env' });

    await mod.writeStorageConfig(env, {
      webdav: { baseUrl: 'https://from-kv', password: 'pw-kv' },
    });

    const senv = await mod.resolveStorageEnv(env);
    assert.strictEqual(senv.WEBDAV_BASE_URL, 'https://from-kv', 'KV value should win over env');
    assert.strictEqual(senv.WEBDAV_PASSWORD, 'pw-kv', 'secret should be decrypted into the overlay');
  });

  it('maps telegram main and guest channels to distinct env vars', async function () {
    const mod = await import('../functions/utils/storage-config.js');
    const env = makeEnv();

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
    const env = makeEnv();

    await mod.writeStorageConfig(env, { webdav: { baseUrl: 'https://x', password: 'keep-me' } });
    await mod.writeStorageConfig(env, { webdav: { baseUrl: 'https://y', password: '' } });

    const senv = await mod.resolveStorageEnv(env);
    assert.strictEqual(senv.WEBDAV_BASE_URL, 'https://y', 'non-secret update should apply');
    assert.strictEqual(senv.WEBDAV_PASSWORD, 'keep-me', 'blank secret should preserve prior value');
  });

  it('returns env unchanged when no config is stored', async function () {
    const mod = await import('../functions/utils/storage-config.js');
    const env = makeEnv({ WEBDAV_BASE_URL: 'https://env-only' });
    const senv = await mod.resolveStorageEnv(env);
    assert.strictEqual(senv.WEBDAV_BASE_URL, 'https://env-only');
  });

  it('refuses to save a secret when no encryption key is configured', async function () {
    const mod = await import('../functions/utils/storage-config.js');
    const env = makeEnv({ CONFIG_ENCRYPTION_KEY: undefined });
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

  it('migrates a legacy record into an encrypted committed version', async function () {
    const mod = await import('../functions/utils/storage-config.js');
    const kv = makeKv();
    const coordinator = makeCoordinator();
    kv.store.set('storage_config', JSON.stringify({
      webdav: { baseUrl: 'https://legacy.example', password: 'legacy-secret' },
    }));
    const env = makeEnv({ img_url: kv, AUTH_COORDINATOR: coordinator });

    const resolved = await mod.resolveStorageEnv(env);
    const migrated = JSON.parse(kv.store.get('storage_config:v1'));

    assert.strictEqual(resolved.WEBDAV_PASSWORD, 'legacy-secret');
    assert.match(migrated.config.webdav.password, /^enc:v1:/);
    assert.strictEqual(coordinator.state.committedVersion, 1);
  });

  it('does not commit an unreadable encrypted legacy record', async function () {
    const mod = await import('../functions/utils/storage-config.js');
    const kv = makeKv();
    const coordinator = makeCoordinator();
    kv.store.set('storage_config', JSON.stringify({
      webdav: { password: 'enc:v1:invalid-ciphertext' },
    }));
    const env = makeEnv({ img_url: kv, AUTH_COORDINATOR: coordinator });

    await assert.rejects(
      () => mod.resolveStorageEnv(env),
      (error) => error?.code === 'STORAGE_CONFIG_UNAVAILABLE',
    );
    assert.strictEqual(coordinator.state.committedVersion, null);
    assert.strictEqual(kv.store.has('storage_config:v1'), false);
  });

  it('aborts instead of committing when KV read-back is not visible', async function () {
    const mod = await import('../functions/utils/storage-config.js');
    const baseKv = makeKv();
    const kv = {
      store: baseKv.store,
      put: baseKv.put,
      async get(key, options) {
        if (String(key).startsWith('storage_config:v')) return null;
        return baseKv.get(key, options);
      },
    };
    const coordinator = makeCoordinator();
    const env = makeEnv({ img_url: kv, AUTH_COORDINATOR: coordinator });

    await assert.rejects(
      () => mod.writeStorageConfig(env, { webdav: { baseUrl: 'https://new.example' } }),
      (error) => error?.code === 'STORAGE_CONFIG_UNAVAILABLE',
    );
    assert.strictEqual(coordinator.state.committedVersion, null);
    assert.strictEqual(coordinator.state.pending, null);
  });

  it('retries an idempotent coordinator commit after a transient response failure', async function () {
    const mod = await import('../functions/utils/storage-config.js');
    const coordinator = makeCoordinator({ failFirstCommit: true });
    const env = makeEnv({ AUTH_COORDINATOR: coordinator });

    await mod.writeStorageConfig(env, { webdav: { baseUrl: 'https://new.example' } });

    assert.strictEqual(coordinator.state.commitAttempts, 2);
    assert.strictEqual(coordinator.state.committedVersion, 1);
  });
});
