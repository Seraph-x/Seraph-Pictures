const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

describe('legacy storage profile settings', function () {
  it('uses extracted assets and keeps the HTML shell below the source limit', function () {
    const html = read('storage-settings.html');
    assert.ok(html.split('\n').length <= 300);
    assert.match(html, /legacy\/pages\/storage-settings\.css/);
    for (const moduleName of ['api', 'selection', 'messages', 'settings-renderer', 'settings-controller']) {
      assert.match(html, new RegExp(`legacy/storage/${moduleName}\\.js`));
    }
    assert.doesNotMatch(html, /function\s+(fieldInput|groupCard|collect|save)\s*\(/);
    assert.match(html, /data-i18n="storage\.title"/);
  });

  it('declares required legacy assets and fails when an entry is absent', function () {
    const copyScript = read('frontend/scripts/copy-legacy.mjs');
    assert.match(copyScript, /const legacyDirs = \['legacy'\]/);
    assert.doesNotMatch(copyScript, /if \(!fs\.existsSync\(from\)\) return/);
    assert.match(copyScript, /throw new Error\([^)]*legacy asset/i);
  });

  it('renders the approved per-card selectors, actions, locks, and masked fields', function () {
    const renderer = read('legacy/storage/settings-renderer.js');
    assert.match(renderer, /data-storage-profile-select/);
    assert.match(renderer, /LEGACY_STORAGE_ACTIONS[^\n]*add[^\n]*edit[^\n]*toggle[^\n]*default[^\n]*delete[^\n]*test/);
    assert.match(renderer, /'data-action': action/);
    assert.match(renderer, /input\.readOnly\s*=\s*!editing/);
    assert.match(renderer, /input\.type\s*=\s*field\.secret\s*\?\s*["']password["']/);
    assert.match(renderer, /profile\?\.isDefault/);
    assert.match(renderer, /data-profile-error/);
    assert.match(renderer, /guest-block/);
  });

  it('keeps same-type selection immutable and status-labelled', function () {
    const selection = require('../legacy/storage/selection.js');
    const profiles = [
      { id: 'tg-a', type: 'telegram', name: 'Primary', enabled: true, isDefault: true, config: {} },
      { id: 'tg-b', type: 'telegram', name: 'Archive', enabled: false, isDefault: false, config: {} },
      { id: 's3-a', type: 's3', name: 'S3', enabled: true, isDefault: true, config: {} },
    ];
    const view = selection.buildTypeSelection({ profiles, type: 'telegram', selectedId: 'tg-b' });
    assert.equal(view.selected.id, 'tg-b');
    assert.deepEqual(view.options.map((item) => item.id), ['tg-a', 'tg-b']);
    assert.match(view.options[0].label, /Primary.*default.*enabled/i);
    assert.match(view.options[1].label, /Archive.*disabled/i);
    assert.ok(Object.isFrozen(view));
    assert.ok(Object.isFrozen(view.selected.config));
  });

  it('protects defaults and exposes test/delete failures beside their card', async function () {
    const { createSettingsController } = require('../legacy/storage/settings-controller.js');
    const calls = [];
    const api = {
      async listProfiles() {
        return [
          { id: 'tg-a', type: 'telegram', name: 'Primary', enabled: true, isDefault: true, config: {} },
          { id: 'tg-b', type: 'telegram', name: 'Archive', enabled: true, isDefault: false, config: {} },
        ];
      },
      async loadGuestConfig() { return { schema: [], config: {}, secretsPresent: {} }; },
      async updateProfile(id, patch) { calls.push(['update', id, patch]); },
      async deleteProfile() { throw new Error('STORAGE_PROFILE_IN_USE'); },
      async testProfile() { throw new Error('STORAGE_TEST_FAILED'); },
    };
    const renders = [];
    const renderer = { bind() {}, render(view) { renders.push(view); } };
    const controller = createSettingsController({ api, renderer, confirmDelete: () => true });
    await controller.start();

    await assert.rejects(
      controller.dispatch({ action: 'toggle', type: 'telegram', id: 'tg-a' }),
      /STORAGE_DEFAULT_LOCKED/,
    );
    assert.equal(calls.length, 0);

    await assert.rejects(
      controller.dispatch({ action: 'delete', type: 'telegram', id: 'tg-b' }),
      /STORAGE_PROFILE_IN_USE/,
    );
    assert.equal(renders.at(-1).errors.telegram, 'STORAGE_PROFILE_IN_USE');

    await assert.rejects(
      controller.dispatch({ action: 'test', type: 'telegram', id: 'tg-b' }),
      /STORAGE_TEST_FAILED/,
    );
    assert.equal(renders.at(-1).errors.telegram, 'STORAGE_TEST_FAILED');
  });

  it('sends exact profile IDs for edit, enable, and default actions', async function () {
    const { createSettingsController } = require('../legacy/storage/settings-controller.js');
    const calls = [];
    const profiles = [
      {
        id: 'tg-a', type: 'telegram', name: 'Primary', enabled: true, isDefault: true,
        config: { botToken: '********', chatId: 'primary' },
      },
      {
        id: 'tg-b', type: 'telegram', name: 'Archive', enabled: true, isDefault: false,
        config: { botToken: '********', chatId: 'archive' },
      },
    ];
    const api = {
      async listProfiles() { return profiles; },
      async loadGuestConfig() { return { schema: [], config: {}, secretsPresent: {} }; },
      async updateProfile(id, patch) { calls.push(['update', id, patch]); return { ...profiles[1], ...patch, id }; },
      async setDefault(id) { calls.push(['default', id]); return { ...profiles[1], id, enabled: true, isDefault: true }; },
    };
    const controller = createSettingsController({
      api, renderer: { bind() {}, render() {} }, confirmDelete: () => true,
    });
    await controller.start();
    await controller.dispatch({ action: 'toggle', type: 'telegram', id: 'tg-b' });
    await controller.dispatch({ action: 'edit', type: 'telegram', id: 'tg-b' });
    await controller.dispatch({
      action: 'save', type: 'telegram',
      payload: { name: 'Archive 2', config: { botToken: '********', chatId: 'archive-2' } },
    });
    await controller.dispatch({ action: 'default', type: 'telegram', id: 'tg-b' });

    assert.deepEqual(calls.map((item) => item.slice(0, 2)), [
      ['update', 'tg-b'], ['update', 'tg-b'], ['default', 'tg-b'],
    ]);
    assert.equal(calls[1][2].enabled, true);
    assert.equal(calls[1][2].config.botToken, '********');
  });

  it('rejects malformed success envelopes instead of degrading to success', async function () {
    const { createStorageApi } = require('../legacy/storage/api.js');
    const response = (payload) => ({ ok: true, status: 200, async json() { return payload; } });
    const api = createStorageApi({
      fetchImpl: async (url, init) => response(init.method === 'DELETE'
        ? {}
        : (url.endsWith('/test') ? { success: true, result: null } : { success: true })),
      onUnauthorized() {},
    });

    await assert.rejects(api.createProfile({}), /STORAGE_ITEM_RESPONSE_INVALID/);
    await assert.rejects(api.listProfiles(), /STORAGE_LIST_RESPONSE_INVALID/);
    await assert.rejects(api.testProfile('tg-a'), /STORAGE_TEST_RESPONSE_INVALID/);
    await assert.rejects(api.loadGuestConfig(), /STORAGE_GUEST_RESPONSE_INVALID/);
    await assert.rejects(api.deleteProfile('tg-a'), /STORAGE_RESPONSE_INVALID/);
  });

  it('accepts only the documented root success envelopes', async function () {
    const { createStorageApi } = require('../legacy/storage/api.js');
    const profile = { id: 'tg-a', name: 'Primary', type: 'telegram', config: {} };
    const guest = { schema: [], config: {}, secretsPresent: {} };
    const response = (payload) => ({ ok: true, status: 200, async json() { return payload; } });
    const api = createStorageApi({
      fetchImpl: async (url) => response(url === '/api/storage-config'
        ? { success: true, ...guest }
        : { success: true, item: profile }),
      onUnauthorized() {},
    });

    assert.equal((await api.createProfile({})).id, 'tg-a');
    assert.deepEqual(await api.loadGuestConfig(), guest);
  });

  it('keeps connection results scoped to the exact selected profile', async function () {
    const { createSettingsController } = require('../legacy/storage/settings-controller.js');
    const profiles = [
      { id: 'tg-a', type: 'telegram', name: 'Primary', enabled: true, isDefault: true, config: {} },
      { id: 'tg-b', type: 'telegram', name: 'Archive', enabled: true, isDefault: false, config: {} },
    ];
    const views = [];
    const controller = createSettingsController({
      api: {
        async listProfiles() { return profiles; },
        async loadGuestConfig() { return { schema: [], config: {}, secretsPresent: {} }; },
        async testProfile() { return { connected: true }; },
      },
      renderer: { bind() {}, render(view) { views.push(view); } },
    });
    await controller.start();
    await controller.dispatch({ action: 'test', type: 'telegram', id: 'tg-a' });
    assert.equal(views.at(-1).cards[0].result.connected, true);
    await controller.dispatch({ action: 'select', type: 'telegram', id: 'tg-b' });
    assert.equal(views.at(-1).cards[0].result, null);
  });

  it('requests Docker v2 envelopes and preserves exact legacy error codes', async function () {
    const { createStorageApi } = require('../legacy/storage/api.js');
    let observedInit = null;
    const api = createStorageApi({
      fetchImpl: async (_url, init) => {
        observedInit = init;
        return {
          ok: false,
          status: 409,
          async json() {
            return {
              success: false,
              error: 'Storage operation failed.',
              errorCode: 'STORAGE_PROFILE_IN_USE',
            };
          },
        };
      },
      onUnauthorized() {},
    });

    await assert.rejects(api.deleteProfile('tg-a'), /STORAGE_PROFILE_IN_USE/);
    assert.equal(observedInit.headers['X-Seraph-Client'], 'app-v2');
    assert.match(observedInit.headers.Accept, /application\/vnd\.seraph\.v2\+json/);
  });
});

describe('legacy upload and admin profile interfaces', function () {
  const uploadModules = [
    'app', 'state', 'profile-mixin', 'upload-methods', 'multipart-methods',
    'history-methods', 'url-upload-methods', 'auth-methods', 'i18n',
  ];
  const adminModules = [
    'app', 'state', 'api', 'auth-methods', 'profile-mixin', 'drive-methods',
    'folder-methods', 'dashboard-methods', 'migration-methods', 'settings-methods',
  ];

  it('extracts both Vue 2 shells and every planned behavior module', function () {
    for (const shell of ['index.html', 'admin.html']) {
      assert.ok(read(shell).split('\n').length <= 300, `${shell} exceeds 300 lines`);
    }
    for (const name of uploadModules) {
      assert.ok(fs.existsSync(path.join(ROOT, `legacy/pages/upload/${name}.js`)), name);
    }
    for (const name of adminModules) {
      assert.ok(fs.existsSync(path.join(ROOT, `legacy/pages/admin/${name}.js`)), name);
    }
    assert.doesNotMatch(read('index.html'), /new Vue\s*\(/);
    assert.doesNotMatch(read('admin.html'), /new Vue\s*\(/);
  });

  it('keeps every extracted legacy page asset below 300 lines', function () {
    for (const page of ['upload', 'admin']) {
      const directory = path.join(ROOT, `legacy/pages/${page}`);
      const pending = [directory];
      while (pending.length) {
        const current = pending.pop();
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
          const target = path.join(current, entry.name);
          if (entry.isDirectory()) pending.push(target);
          if (!entry.isFile() || !/\.(?:js|css)$/.test(entry.name)) continue;
          const lines = fs.readFileSync(target, 'utf8').split('\n').length;
          assert.ok(lines <= 300, `${path.relative(ROOT, target)} exceeds 300 lines`);
        }
      }
    }
  });

  it('snapshots exact upload instances and forwards them through every transport', function () {
    const profileModule = require('../legacy/pages/upload/profile-mixin.js');
    const target = profileModule.snapshotUploadTarget({
      storageMode: 'telegram',
      profile: { id: 'tg-a', type: 'telegram', name: 'Primary', enabled: true },
      folderPath: 'album',
    });
    const next = profileModule.snapshotUploadTarget({
      storageMode: 'telegram',
      profile: { id: 'tg-b', type: 'telegram', name: 'Archive', enabled: true },
      folderPath: 'later',
    });
    assert.deepEqual(target, {
      storageMode: 'telegram', storageId: 'tg-a', storageName: 'Primary', folderPath: 'album',
    });
    assert.equal(target.storageId, 'tg-a');
    assert.equal(next.storageId, 'tg-b');
    assert.ok(Object.isFrozen(target));

    const appended = [];
    profileModule.appendUploadTarget({ append: (...args) => appended.push(args) }, target);
    assert.deepEqual(appended, [
      ['storageMode', 'telegram'], ['storageId', 'tg-a'], ['folderPath', 'album'],
    ]);
    assert.deepEqual(profileModule.buildUrlUploadPayload({ url: 'https://example.test/a.png', target }), {
      url: 'https://example.test/a.png', storageMode: 'telegram', storageId: 'tg-a', folderPath: 'album',
    });
    assert.deepEqual(profileModule.buildMultipartInit({ file: { name: 'a.png', size: 7, type: 'image/png' }, target }), {
      fileName: 'a.png', fileSize: 7, fileType: 'image/png',
      storageMode: 'telegram', storageId: 'tg-a', folderPath: 'album',
    });
  });

  it('keeps Guest isolated and reports remembered profile replacement', function () {
    const profileModule = require('../legacy/pages/upload/profile-mixin.js');
    const profiles = [
      { id: 'tg-a', type: 'telegram', name: 'Primary', enabled: true, isDefault: true },
      { id: 'tg-b', type: 'telegram', name: 'Disabled', enabled: false, isDefault: false },
    ];
    assert.deepEqual(profileModule.resolveUploadSelection({
      profiles, storageMode: 'telegram', rememberedId: 'tg-b', isGuest: false,
    }), { profile: profiles[0], notice: 'STORAGE_PROFILE_SELECTION_RESET' });
    assert.throws(() => profileModule.resolveUploadSelection({
      profiles, storageMode: 'telegram', rememberedId: 'tg-a', isGuest: true,
    }), /GUEST_PROFILE_ENUMERATION_FORBIDDEN/);
  });

  it('builds exact admin filters, enabled migration targets, and labels', function () {
    const profileModule = require('../legacy/pages/admin/profile-mixin.js');
    assert.equal(profileModule.buildProfileQuery({ storageId: 'tg-a' }).toString(), 'storageId=tg-a');
    const profiles = [
      { id: 'tg-a', type: 'telegram', name: 'Primary', enabled: true },
      { id: 'tg-b', type: 'telegram', name: 'Archive', enabled: true },
      { id: 'tg-c', type: 'telegram', name: 'Disabled', enabled: false },
    ];
    assert.deepEqual(
      profileModule.migrationTargets({ profiles, sourceIds: ['tg-a'] }).map((item) => item.id),
      ['tg-b'],
    );
    assert.equal(profileModule.profileLabel({
      metadata: { storageType: 'telegram', storageName: 'Archive' },
    }), 'telegram · Archive');
  });

  it('wires the upload picker without exposing profiles to Guest', function () {
    const template = read('legacy/pages/upload/components/storage-target-picker.js');
    const methods = [
      read('legacy/pages/upload/upload-methods.js'),
      read('legacy/pages/upload/upload-methods-2.js'),
      read('legacy/pages/upload/upload-methods-3.js'),
      read('legacy/pages/upload/url-upload-methods.js'),
      read('legacy/pages/upload/multipart-methods.js'),
    ].join('\n');
    assert.match(template, /data-storage-profile-select/);
    assert.match(template, /v-if="!isGuest"/);
    assert.match(template, /uploadProfileChoices/);
    assert.match(methods, /snapshotUploadTarget/);
    assert.match(methods, /uploadTarget:\s*context/);
    assert.match(methods, /appendUploadTarget/);
    assert.match(methods, /buildUrlUploadPayload/);
    assert.match(methods, /buildMultipartInit/);
    assert.doesNotMatch(methods, /item\.storageMode\s*\|\|\s*this\.storageMode/);
  });

  it('wires exact admin profile filters, labels, and migration controls', function () {
    const templates = fs.readdirSync(path.join(ROOT, 'legacy/pages/admin/components'))
      .map((name) => read(`legacy/pages/admin/components/${name}`)).join('\n');
    const drive = [
      read('legacy/pages/admin/drive-methods.js'),
      read('legacy/pages/admin/drive-methods-2.js'),
      read('legacy/pages/admin/drive-methods-3.js'),
    ].join('\n');
    assert.match(templates, /data-storage-profile-filter/);
    assert.match(templates, /data-migration-storage-profile/);
    assert.match(templates, /getProfileLabel\((?:item|scope\.row)\)/);
    assert.match(drive, /params\.set\('storageId',\s*this\.storageProfileId\)/);
    assert.match(read('legacy/pages/admin/migration-methods.js'), /migrateSelectedFiles/);
  });

  it('binds UI design uploads to the exact enabled admin profile', async function () {
    const previousMixins = global.LegacyAdminMixins;
    const previousFetch = global.fetch;
    global.LegacyAdminMixins = [];
    delete require.cache[require.resolve('../legacy/pages/admin/dashboard-methods.js')];
    require('../legacy/pages/admin/dashboard-methods.js');
    const method = global.LegacyAdminMixins[0].methods.uploadUiDesignBackgroundFile;
    let submitted = null;
    global.fetch = async (_url, init) => {
      submitted = init.body;
      return { ok: true, async json() { return [{ src: '/file/background' }]; } };
    };
    try {
      const context = {
        baseURL: 'https://example.test', folderPath: 'branding',
        selectedStorageProfile: { id: 'r2-brand', type: 'r2', enabled: true },
        t: () => 'upload failed',
      };
      const result = await method.call(context, new Blob(['image']));
      assert.equal(result, 'https://example.test/file/background');
      assert.equal(submitted.get('storageMode'), 'r2');
      assert.equal(submitted.get('storageId'), 'r2-brand');
      await assert.rejects(
        method.call({ ...context, selectedStorageProfile: null }, new Blob(['image'])),
        /STORAGE_SELECTION_REQUIRED/,
      );
    } finally {
      global.fetch = previousFetch;
      global.LegacyAdminMixins = previousMixins;
    }
  });

  it('exposes malformed UI design upload responses', async function () {
    const previousMixins = global.LegacyAdminMixins;
    const previousFetch = global.fetch;
    global.LegacyAdminMixins = [];
    delete require.cache[require.resolve('../legacy/pages/admin/dashboard-methods.js')];
    require('../legacy/pages/admin/dashboard-methods.js');
    const method = global.LegacyAdminMixins[0].methods.uploadUiDesignBackgroundFile;
    global.fetch = async () => ({
      ok: true,
      async json() { throw new Error('INVALID_UPLOAD_JSON'); },
    });
    try {
      await assert.rejects(method.call({
        baseURL: '', folderPath: '', t: () => 'upload failed',
        selectedStorageProfile: { id: 'tg-a', type: 'telegram', enabled: true },
      }, new Blob(['image'])), /INVALID_UPLOAD_JSON/);
    } finally {
      global.fetch = previousFetch;
      global.LegacyAdminMixins = previousMixins;
    }
  });

  it('distinguishes delete cancellation from confirmation failures', async function () {
    const previousMixins = global.LegacyAdminMixins;
    global.LegacyAdminMixins = [];
    delete require.cache[require.resolve('../legacy/pages/admin/drive-methods-3.js')];
    require('../legacy/pages/admin/drive-methods-3.js');
    const methods = global.LegacyAdminMixins[0].methods;
    const method = methods.handleDelete;
    const context = {
      ...methods,
      $confirm: async () => { throw new Error('CONFIRM_INFRASTRUCTURE_FAILED'); },
      $message: { info() {}, error() {}, success() {} },
    };
    try {
      await assert.rejects(method.call(context, 0, 'file-a'), /CONFIRM_INFRASTRUCTURE_FAILED/);
      context.$confirm = async () => { throw 'cancel'; };
      await method.call(context, 0, 'file-a');
    } finally {
      global.LegacyAdminMixins = previousMixins;
    }
  });

  it('writes mobile navigation metrics through the document root style', function () {
    const previousMixins = global.LegacyAdminMixins;
    const previousDocument = global.document;
    const previousWindow = global.window;
    const properties = [];
    global.LegacyAdminMixins = [];
    global.document = {
      documentElement: { style: { setProperty: (...args) => properties.push(args) } },
      querySelector: () => null,
    };
    global.window = { matchMedia: () => ({ matches: false }) };
    delete require.cache[require.resolve('../legacy/pages/admin/core-methods.js')];
    require('../legacy/pages/admin/core-methods.js');
    try {
      const method = global.LegacyAdminMixins[0].methods.updateMobileNavMetrics;
      method.call({ $el: null });
      assert.deepEqual(properties, [['--nav-height', '0px'], ['--nav-offset', '0px']]);
    } finally {
      global.document = previousDocument;
      global.window = previousWindow;
      global.LegacyAdminMixins = previousMixins;
    }
  });
});
