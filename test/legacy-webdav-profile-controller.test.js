const assert = require('node:assert/strict');

const selection = require('../legacy/pages/upload/profile-mixin.js');

let profilesModule = null;
try {
  profilesModule = require('../legacy/pages/webdav/profile-controller.js');
} catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error;
}

const DEFAULT_PROFILE = Object.freeze({
  id: 'webdav-default', name: 'Default DAV', type: 'webdav', enabled: true, isDefault: true,
});
const SECONDARY_PROFILE = Object.freeze({
  id: 'webdav-secondary', name: 'Secondary DAV', type: 'webdav', enabled: true, isDefault: false,
});
const DISABLED_PROFILE = Object.freeze({
  id: 'webdav-disabled', name: 'Disabled DAV', type: 'webdav', enabled: false, isDefault: false,
});
const OTHER_PROFILE = Object.freeze({
  id: 's3-default', name: 'S3', type: 's3', enabled: true, isDefault: true,
});

function memory(rememberedId = '') {
  let value = rememberedId
    ? JSON.stringify({ version: 1, byType: { webdav: rememberedId } })
    : null;
  return {
    getItem: () => value,
    setItem: (_key, next) => { value = next; },
    value: () => value,
  };
}

function createController(options = {}) {
  assert.ok(profilesModule, 'WebDAV profile controller module should exist');
  const states = [];
  const api = {
    listProfiles: async () => options.profiles || [],
    testProfile: async () => ({ connected: true }),
  };
  if (options.listError) api.listProfiles = async () => { throw options.listError; };
  const controller = profilesModule.createController({
    api, selection, storage: memory(options.rememberedId), onChange: (state) => states.push(state),
  });
  return { controller, states };
}

describe('legacy WebDAV profile controller selection', function () {
  it('restores an enabled remembered WebDAV selection and filters other profiles', async function () {
    const { controller } = createController({
      profiles: [OTHER_PROFILE, DISABLED_PROFILE, DEFAULT_PROFILE, SECONDARY_PROFILE],
      rememberedId: SECONDARY_PROFILE.id,
    });
    await controller.load();
    assert.deepEqual(controller.getState().profiles.map((item) => item.id), [
      DEFAULT_PROFILE.id, SECONDARY_PROFILE.id,
    ]);
    assert.equal(controller.getState().selectedId, SECONDARY_PROFILE.id);
  });

  it('uses the enabled default when no selection is remembered', async function () {
    const { controller } = createController({ profiles: [SECONDARY_PROFILE, DEFAULT_PROFILE] });
    await controller.load();
    assert.equal(controller.getState().selectedId, DEFAULT_PROFILE.id);
    assert.equal(controller.getState().notice, '');
  });

  it('uses the first enabled WebDAV profile when no default exists', async function () {
    const { controller } = createController({ profiles: [SECONDARY_PROFILE] });
    await controller.load();
    assert.equal(controller.getState().selectedId, SECONDARY_PROFILE.id);
  });

  it('resets an invalid remembered selection with an explicit notice', async function () {
    const { controller } = createController({
      profiles: [DEFAULT_PROFILE], rememberedId: DISABLED_PROFILE.id,
    });
    await controller.load();
    assert.equal(controller.getState().selectedId, DEFAULT_PROFILE.id);
    assert.equal(controller.getState().notice, 'STORAGE_PROFILE_SELECTION_RESET');
  });

  it('publishes an empty selection when no enabled WebDAV exists', async function () {
    const { controller } = createController({ profiles: [OTHER_PROFILE, DISABLED_PROFILE] });
    await controller.load();
    assert.equal(controller.getState().phase, 'empty');
    assert.equal(controller.getState().selectedId, '');
    assert.equal(controller.getState().canUpload, false);
  });

  it('publishes the list error without inventing a selection', async function () {
    const { controller } = createController({ listError: new Error('STORAGE_CONFIG_UNAVAILABLE') });
    await controller.load();
    assert.equal(controller.getState().phase, 'error');
    assert.equal(controller.getState().error, 'STORAGE_CONFIG_UNAVAILABLE');
    assert.equal(controller.getState().canUpload, false);
  });
});

describe('legacy WebDAV profile controller snapshot', function () {
  it('creates an immutable exact-profile upload target', async function () {
    const { controller } = createController({ profiles: [DEFAULT_PROFILE] });
    await controller.load();
    const target = controller.snapshot('Project/July');
    assert.deepEqual(target, {
      storageMode: 'webdav', storageId: DEFAULT_PROFILE.id,
      storageName: DEFAULT_PROFILE.name, folderPath: 'Project/July',
    });
    assert.equal(Object.isFrozen(target), true);
  });

  it('rejects snapshots without an available selection', async function () {
    const { controller } = createController({ profiles: [] });
    await controller.load();
    assert.throws(() => controller.snapshot(''), /STORAGE_SELECTION_REQUIRED/);
  });
});
