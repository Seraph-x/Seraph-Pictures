const assert = require('node:assert');

function createNamespace(handler) {
  return {
    idFromName() { return 'singleton-id'; },
    get() {
      return {
        async fetch(request) {
          const operation = new URL(request.url).pathname.split('/').at(-1);
          const data = await handler(operation, await request.json());
          return new Response(JSON.stringify({ data }), {
            headers: { 'Content-Type': 'application/json' },
          });
        },
      };
    },
  };
}

describe('Passkey coordinator store', function () {
  it('stores credentials and one-time challenges only through coordinator operations', async function () {
    const store = await import('../functions/utils/auth/passkey-store.js');
    const calls = [];
    const responses = {
      passkeyMigrationStatus: { migrated: true },
      listPasskeys: { items: [{ id: 'credential-1', publicKey: 'base64' }] },
      putPasskeyChallenge: { ok: true },
      takePasskeyChallenge: { challenge: 'challenge-1' },
      savePasskey: { ok: true },
    };
    const env = {
      img_url: { get() { throw new Error('KV must not be used'); } },
      AUTH_COORDINATOR: createNamespace((operation, payload) => {
        calls.push({ operation, payload });
        return responses[operation];
      }),
    };

    assert.deepStrictEqual(await store.listPasskeys(env), responses.listPasskeys);
    await store.putPasskeyChallenge(env, 'auth', 'challenge-1');
    assert.strictEqual(await store.takePasskeyChallenge(env, 'auth'), 'challenge-1');
    await store.savePasskey(env, { id: 'credential-1', publicKey: 'base64' });
    assert.deepStrictEqual(calls.map((call) => call.operation), [
      'passkeyMigrationStatus', 'listPasskeys',
      'passkeyMigrationStatus', 'putPasskeyChallenge',
      'passkeyMigrationStatus', 'takePasskeyChallenge',
      'passkeyMigrationStatus', 'savePasskey',
    ]);
  });

  it('migrates legacy KV passkeys once and removes obsolete KV state', async function () {
    const store = await import('../functions/utils/auth/passkey-store.js');
    const legacy = { items: [{ id: 'legacy-key', publicKey: 'base64' }] };
    const calls = [];
    const deleted = [];
    const env = {
      img_url: {
        async get(name) { return name === 'webauthn_credentials' ? legacy : null; },
        async delete(name) { deleted.push(name); },
      },
      AUTH_COORDINATOR: createNamespace((operation, payload) => {
        calls.push({ operation, payload });
        if (operation === 'passkeyMigrationStatus') return { migrated: false };
        if (operation === 'migrateLegacyPasskeys') return { ok: true, items: legacy.items };
        if (operation === 'completeLegacyPasskeyCleanup') return { ok: true };
        throw new Error(`Unexpected operation: ${operation}`);
      }),
    };

    assert.deepStrictEqual(await store.listPasskeys(env), legacy);
    assert.strictEqual(calls[1].operation, 'migrateLegacyPasskeys');
    assert.deepStrictEqual(calls[1].payload.items, legacy.items);
    assert.strictEqual(calls.at(-1).operation, 'completeLegacyPasskeyCleanup');
    assert.deepStrictEqual(deleted, [
      'webauthn_credentials', 'webauthn_challenge:register', 'webauthn_challenge:auth',
    ]);
  });
});
