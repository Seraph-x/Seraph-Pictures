const assert = require('node:assert');

const PROFILE = Object.freeze({
  id: 'sc:telegram-primary',
  name: 'Primary Telegram',
  type: 'telegram',
  enabled: true,
  isDefault: true,
  config: Object.freeze({ botToken: 'token', chatId: 'chat' }),
});

function policy() {
  return require('../shared/storage/profile-policy.cjs');
}

describe('shared storage profile policy', function () {
  it('makes the first enabled profile of each type the default', function () {
    const { isDefault: _ignored, ...firstProfile } = PROFILE;
    const telegram = policy().validateProfileMutation({
      items: [],
      current: null,
      patch: firstProfile,
      references: 0,
    });
    const r2 = policy().validateProfileMutation({
      items: [telegram],
      current: null,
      patch: {
        id: 'sc:r2-primary', name: 'R2', type: 'r2', enabled: true,
        config: { adapterMode: 'binding', bindingName: 'R2_BUCKET' },
      },
      references: 0,
    });

    assert.strictEqual(telegram.isDefault, true);
    assert.strictEqual(r2.isDefault, true);
    assert.ok(Object.isFrozen(telegram) && Object.isFrozen(r2));
  });

  it('rejects contradictory first-profile state', function () {
    assert.throws(
      () => policy().validateProfileMutation({
        items: [], current: null,
        patch: { ...PROFILE, enabled: false, isDefault: false }, references: 0,
      }),
      (error) => error.code === 'STORAGE_DEFAULT_REQUIRED',
    );
  });

  it('sets exactly one default within the selected profile type', function () {
    const items = [
      PROFILE,
      { ...PROFILE, id: 'sc:telegram-secondary', isDefault: false },
      { ...PROFILE, id: 'sc:r2-primary', type: 'r2', isDefault: true },
    ];
    const result = policy().applyPerTypeDefault({
      items,
      profileId: 'sc:telegram-secondary',
    });

    assert.deepStrictEqual(result.map(({ id, isDefault }) => ({ id, isDefault })), [
      { id: 'sc:telegram-primary', isDefault: false },
      { id: 'sc:telegram-secondary', isDefault: true },
      { id: 'sc:r2-primary', isDefault: true },
    ]);
    assert.ok(Object.isFrozen(result));
  });

  it('rejects creating a second default through a generic mutation', function () {
    assert.throws(
      () => policy().validateProfileMutation({
        items: [PROFILE], current: null,
        patch: { ...PROFILE, id: 'sc:telegram-secondary' }, references: 0,
      }),
      (error) => error.code === 'STORAGE_DEFAULT_REQUIRED',
    );
  });

  it('locks default profiles against disabling and deletion', function () {
    const options = { items: [PROFILE], current: PROFILE, references: 0 };
    assert.throws(
      () => policy().validateProfileMutation({ ...options, patch: { enabled: false } }),
      (error) => error.code === 'STORAGE_DEFAULT_LOCKED' && error.status === 409,
    );
    assert.throws(
      () => policy().validateProfileMutation({ ...options, patch: null }),
      (error) => error.code === 'STORAGE_DEFAULT_LOCKED' && error.status === 409,
    );
  });

  it('rejects changing the type of a referenced profile', function () {
    assert.throws(
      () => policy().validateProfileMutation({
        items: [PROFILE], current: PROFILE,
        patch: { type: 'discord', config: { botToken: 'new-token' } }, references: 1,
      }),
      (error) => error.code === 'STORAGE_PROFILE_IN_USE' && error.status === 409,
    );
  });

  it('resolves an exact ID only when its type matches', function () {
    const items = [PROFILE, { ...PROFILE, id: 'sc:r2-primary', type: 'r2' }];
    assert.strictEqual(policy().resolveProfileSelection({
      items, storageId: PROFILE.id, storageMode: 'telegram', preferredType: 'r2', forWrite: true,
    }).id, PROFILE.id);
    assert.throws(
      () => policy().resolveProfileSelection({
        items, storageId: PROFILE.id, storageMode: 'r2', preferredType: 'r2', forWrite: true,
      }),
      (error) => error.code === 'STORAGE_TYPE_MISMATCH',
    );
    assert.throws(
      () => policy().resolveProfileSelection({
        items, storageId: 'missing', storageMode: 'telegram', preferredType: 'r2', forWrite: true,
      }),
      (error) => error.code === 'STORAGE_PROFILE_NOT_FOUND' && error.status === 404,
    );
  });

  it('uses the preferred type default when no selector is supplied', function () {
    const preferred = { ...PROFILE, id: 'sc:r2-primary', type: 'r2' };
    const result = policy().resolveProfileSelection({
      items: [PROFILE, preferred], preferredType: 'r2', forWrite: true,
    });
    assert.strictEqual(result.id, preferred.id);
  });

  it('rejects disabled write targets but allows historical reads', function () {
    const disabled = { ...PROFILE, enabled: false, isDefault: false };
    assert.throws(
      () => policy().resolveProfileSelection({
        items: [disabled], storageId: disabled.id, storageMode: disabled.type, forWrite: true,
      }),
      (error) => error.code === 'STORAGE_NOT_WRITABLE' && error.status === 409,
    );
    assert.strictEqual(policy().resolveProfileSelection({
      items: [disabled], storageId: disabled.id, storageMode: disabled.type, forWrite: false,
    }), disabled);
  });

  it('validates explicit R2 binding and S3 adapter modes', function () {
    assert.deepStrictEqual(policy().validateProfileConfig({
      type: 'r2', config: { adapterMode: 'binding', bindingName: 'R2_BUCKET' },
    }), { adapterMode: 'binding', bindingName: 'R2_BUCKET' });
    assert.throws(
      () => policy().validateProfileConfig({ type: 'r2', config: { adapterMode: 'binding' } }),
      (error) => error.code === 'STORAGE_CONFIG_REQUIRED' && error.field === 'bindingName',
    );
    assert.deepStrictEqual(policy().validateProfileConfig({
      type: 'r2',
      config: {
        adapterMode: 's3', endpoint: 'https://r2.test', bucket: 'files',
        accessKeyId: 'key', secretAccessKey: 'secret',
      },
    }), {
      adapterMode: 's3', endpoint: 'https://r2.test', bucket: 'files',
      accessKeyId: 'key', secretAccessKey: 'secret', region: 'auto',
    });
    assert.throws(
      () => policy().validateProfileConfig({ type: 'r2', config: { adapterMode: 's3' } }),
      (error) => error.code === 'STORAGE_CONFIG_REQUIRED' && error.field === 'endpoint',
    );
  });

  it('validates required fields for every provider', function () {
    const { validateProfileConfig } = policy();
    const valid = {
      telegram: { botToken: 'token', chatId: 'chat' },
      s3: { endpoint: 'https://s3', bucket: 'b', accessKeyId: 'a', secretAccessKey: 's' },
      discord: { webhookUrl: 'https://hook' },
      huggingface: { token: 'token', repo: 'u/r' },
      webdav: { baseUrl: 'https://dav', bearerToken: 'token' },
      github: { repo: 'u/r', token: 'token' },
    };
    for (const [type, config] of Object.entries(valid)) {
      assert.deepStrictEqual(validateProfileConfig({ type, config }), config, type);
      assert.throws(() => validateProfileConfig({ type, config: {} }), (error) => (
        ['STORAGE_CONFIG_REQUIRED', 'STORAGE_SECRET_REQUIRED'].includes(error.code)
      ), type);
    }
  });

  it('masks secrets and reports presence without mutating the profile', function () {
    const presented = policy().presentProfile(PROFILE);
    assert.deepStrictEqual(presented.config, { botToken: '********', chatId: 'chat' });
    assert.deepStrictEqual(presented.secretsPresent, { botToken: true });
    assert.strictEqual(PROFILE.config.botToken, 'token');
    assert.ok(Object.isFrozen(presented.config) && Object.isFrozen(presented.secretsPresent));
    assert.deepStrictEqual(policy().presentProfile({
      ...PROFILE, config: { botToken: '********' },
    }).secretsPresent, { botToken: true });
  });
});
