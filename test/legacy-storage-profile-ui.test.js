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
