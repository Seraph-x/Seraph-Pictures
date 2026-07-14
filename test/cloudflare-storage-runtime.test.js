const assert = require('node:assert');

const PROFILES = Object.freeze([
  Object.freeze({
    id: 'tg-main', name: 'Main', type: 'telegram', enabled: true, isDefault: true,
    config: Object.freeze({ botToken: 'main-token', chatId: 'main-chat' }),
  }),
  Object.freeze({
    id: 'tg-archive', name: 'Archive', type: 'telegram', enabled: false, isDefault: false,
    config: Object.freeze({ botToken: 'archive-token', chatId: 'archive-chat' }),
  }),
  Object.freeze({
    id: 'r2-binding', name: 'R2', type: 'r2', enabled: true, isDefault: true,
    config: Object.freeze({ adapterMode: 'binding', bindingName: 'ARCHIVE_BUCKET' }),
  }),
]);

function repository(items = PROFILES) {
  return Object.freeze({
    runtimeSnapshot: async () => Object.freeze({
      generation: 'generation-1',
      items,
      legacyTypeProfileIds: Object.freeze({ telegram: 'tg-main' }),
    }),
  });
}

async function resolverFixture(options = {}) {
  const { createStorageProfileResolver } = await import(
    '../functions/services/storage-runtime/profile-resolver.js'
  );
  const barrier = Object.freeze({
    status: async () => Object.freeze({ frozen: Boolean(options.frozen) }),
  });
  return createStorageProfileResolver({
    repository: repository(options.items), barrier, preferredType: 'telegram',
  });
}

describe('Cloudflare storage runtime resolver', function () {
  it('resolves exact IDs and rejects selector type mismatches', async function () {
    const resolver = await resolverFixture();
    assert.strictEqual((await resolver.resolve({
      storageId: 'tg-main', storageMode: 'telegram', forWrite: true,
    })).id, 'tg-main');
    await assert.rejects(resolver.resolve({
      storageId: 'tg-main', storageMode: 'r2', forWrite: true,
    }), { code: 'STORAGE_TYPE_MISMATCH' });
  });

  it('resolves a requested type default and the preferred default independently', async function () {
    const resolver = await resolverFixture();
    assert.strictEqual((await resolver.resolve({ storageMode: 'r2', forWrite: true })).id, 'r2-binding');
    assert.strictEqual((await resolver.resolve({ forWrite: true })).id, 'tg-main');
  });

  it('allows disabled historical reads but rejects disabled write targets', async function () {
    const resolver = await resolverFixture();
    assert.strictEqual((await resolver.resolve({
      storageId: 'tg-archive', storageMode: 'telegram', forWrite: false,
    })).id, 'tg-archive');
    await assert.rejects(resolver.resolve({
      storageId: 'tg-archive', storageMode: 'telegram', forWrite: true,
    }), { code: 'STORAGE_NOT_WRITABLE' });
  });

  it('treats a missing persisted profile as an integrity failure', async function () {
    const resolver = await resolverFixture();
    await assert.rejects(resolver.resolve({
      storageId: 'missing', storageMode: 'telegram', forWrite: false, persisted: true,
    }), { code: 'STORAGE_PROFILE_INTEGRITY_ERROR' });
  });

  it('uses the generation-scoped legacy mapping without consulting current defaults', async function () {
    const resolver = await resolverFixture();
    const profile = await resolver.resolve({
      storageMode: 'telegram', forWrite: false, persisted: true, legacy: true,
    });
    assert.strictEqual(profile.id, 'tg-main');
    assert.strictEqual(profile.generation, 'generation-1');
  });

  it('rejects new writes while the mutation barrier is frozen', async function () {
    const resolver = await resolverFixture({ frozen: true });
    await assert.rejects(resolver.resolve({ storageMode: 'telegram', forWrite: true }), {
      code: 'STORAGE_PROFILE_MUTATION_FROZEN',
    });
    assert.strictEqual((await resolver.resolve({
      storageId: 'tg-main', storageMode: 'telegram', forWrite: false,
    })).id, 'tg-main');
  });
});

describe('Cloudflare storage adapter factory', function () {
  it('builds profile-only Telegram credentials without inheriting global values', async function () {
    const { createStorageAdapter } = await import(
      '../functions/services/storage-runtime/adapter-factory.js'
    );
    const adapter = createStorageAdapter({
      profile: PROFILES[0],
      env: { TG_Bot_Token: 'global-token', TG_Chat_ID: 'global-chat' },
    });
    assert.strictEqual(adapter.environment.TG_Bot_Token, 'main-token');
    assert.strictEqual(adapter.environment.TG_Chat_ID, 'main-chat');
    assert.strictEqual(adapter.environment.CUSTOM_BOT_API_URL, undefined);
  });

  it('uses the configured R2 binding name rather than the legacy global binding', async function () {
    const { createStorageAdapter } = await import(
      '../functions/services/storage-runtime/adapter-factory.js'
    );
    const archive = { name: 'archive' };
    const adapter = createStorageAdapter({
      profile: PROFILES[2], env: { ARCHIVE_BUCKET: archive, R2_BUCKET: { name: 'legacy' } },
    });
    assert.strictEqual(adapter.mode, 'binding');
    assert.strictEqual(adapter.binding, archive);
  });

  it('constructs R2 S3 mode from only the selected profile config', async function () {
    const { createStorageAdapter } = await import(
      '../functions/services/storage-runtime/adapter-factory.js'
    );
    let received;
    const profile = {
      id: 'r2-s3', type: 'r2', enabled: true,
      config: {
        adapterMode: 's3', endpoint: 'https://profile.example', bucket: 'profile-bucket',
        accessKeyId: 'profile-key', secretAccessKey: 'profile-secret', region: 'auto',
      },
    };
    const adapter = createStorageAdapter({
      profile,
      env: { S3_ENDPOINT: 'https://global.example', S3_ACCESS_KEY_ID: 'global-key' },
      factories: { s3: (environment) => { received = environment; return { kind: 's3' }; } },
    });
    assert.strictEqual(adapter.mode, 's3');
    assert.strictEqual(received.S3_ENDPOINT, 'https://profile.example');
    assert.strictEqual(received.S3_ACCESS_KEY_ID, 'profile-key');
    assert.strictEqual(received.R2_BUCKET, undefined);
  });

  it('keeps draft probes isolated from unrelated global credentials', async function () {
    const { testStorageProfile } = await import('../functions/services/storage-profiles/tester.js');
    const result = await testStorageProfile({
      env: { TG_Bot_Token: 'global-token', TG_Chat_ID: 'global-chat' },
      type: 'telegram',
      config: {},
    });
    assert.strictEqual(result.configured, false);
    assert.strictEqual(result.connected, false);
  });

  it('probes the selected R2 binding instead of R2_BUCKET', async function () {
    const { testStorageProfile } = await import('../functions/services/storage-profiles/tester.js');
    const calls = [];
    const result = await testStorageProfile({
      env: {
        ARCHIVE_BUCKET: { list: async () => { calls.push('archive'); return { objects: [] }; } },
        R2_BUCKET: { list: async () => { calls.push('legacy'); return { objects: [] }; } },
      },
      type: 'r2',
      config: { adapterMode: 'binding', bindingName: 'ARCHIVE_BUCKET' },
    });
    assert.strictEqual(result.connected, true);
    assert.deepStrictEqual(calls, ['archive']);
  });
});

describe('profile-aware file delivery', function () {
  it('resolves persisted storageConfigId and passes only selected credentials downstream', async function () {
    const { deliverFile } = await import('../functions/services/file-delivery.js');
    let selection;
    let receivedEnvironment;
    const response = await deliverFile({
      context: {
        request: new Request('https://pictures.example/file/id'),
        env: { TG_Bot_Token: 'global-token', img_url: { kind: 'metadata' } },
      },
      fileId: 'telegram-file',
      record: { metadata: {
        storageType: 'telegram', storageConfigId: 'tg-archive', fileName: 'file.png',
      } },
      dependencies: {
        resolver: { resolve: async (input) => {
          selection = input;
          return PROFILES[1];
        } },
        telegramHandler: async (context) => {
          receivedEnvironment = context.env;
          return new Response('ok');
        },
      },
    });

    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual(selection, {
      storageId: 'tg-archive', storageMode: 'telegram', forWrite: false,
      persisted: true, legacy: false,
    });
    assert.strictEqual(receivedEnvironment.TG_Bot_Token, 'archive-token');
    assert.strictEqual(receivedEnvironment.img_url.kind, 'metadata');
  });

  it('reads an R2 S3-mode profile through its selected client', async function () {
    const { handleR2File } = await import('../functions/services/file-delivery/r2.js');
    let request;
    const response = await handleR2File({
      context: {
        request: new Request('https://pictures.example/file/r2:key', {
          headers: { Range: 'bytes=0-2' },
        }),
        env: {},
      },
      r2Key: 'r2:object-key',
      record: { metadata: { fileName: 'file.bin' } },
      adapter: {
        mode: 's3',
        client: { getObject: async (key, options) => {
          request = { key, options };
          return new Response('abc', { status: 206, headers: { 'Content-Length': '3' } });
        } },
      },
    });

    assert.strictEqual(response.status, 206);
    assert.deepStrictEqual(request, { key: 'object-key', options: { range: 'bytes=0-2' } });
  });
});

describe('Cloudflare storage reference client', function () {
  it('forwards stable operation names and immutable operation context', async function () {
    const { createStorageReferenceClient } = await import(
      '../functions/services/storage-runtime/reference-client.js'
    );
    const { createStorageOperationContext } = await import(
      '../functions/services/storage-runtime/operation-context.js'
    );
    const calls = [];
    const client = createStorageReferenceClient({ coordinator: async (operation, payload) => {
      calls.push([operation, payload]);
      return { operationId: payload.operationId, storageId: payload.storageId };
    } });
    const operation = createStorageOperationContext({
      ids: { create: () => 'operation-1' }, clock: { now: () => 1_000 }, ttlMs: 5_000,
    });
    await client.reserve({ ...operation, storageId: 'tg-main' });
    await client.commitStart({ operationId: operation.operationId });

    assert.deepStrictEqual(operation, { operationId: 'operation-1', expiresAt: 6_000 });
    assert.deepStrictEqual(calls.map(([name]) => name), ['storageRefReserve', 'storageRefCommitStart']);
  });
});
