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
  const storage = options.storage || memory(options.rememberedId);
  const api = {
    listProfiles: options.listProfiles || (async () => options.profiles || []),
    testProfile: options.testProfile || (async () => ({ connected: true })),
  };
  if (options.listError) api.listProfiles = async () => { throw options.listError; };
  const controller = profilesModule.createController({
    api, selection, storage, onChange: (state) => states.push(state),
  });
  return { controller, states, storage };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

async function settle() {
  await new Promise((resolve) => setImmediate(resolve));
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

  it('persists an invalid remembered fallback so the notice only appears once', async function () {
    const storage = memory(DISABLED_PROFILE.id);
    const first = createController({ profiles: [DEFAULT_PROFILE], storage });
    await first.controller.load();
    assert.equal(first.controller.getState().notice, 'STORAGE_PROFILE_SELECTION_RESET');
    assert.equal(JSON.parse(storage.value()).byType.webdav, DEFAULT_PROFILE.id);

    const second = createController({ profiles: [DEFAULT_PROFILE], storage });
    await second.controller.load();
    assert.equal(second.controller.getState().notice, '');
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

  it('ignores a stale profile list response from an earlier load', async function () {
    const first = deferred();
    const second = deferred();
    let calls = 0;
    const { controller } = createController({
      listProfiles: () => (++calls === 1 ? first.promise : second.promise),
    });
    const firstLoad = controller.load();
    const secondLoad = controller.load();
    second.resolve([SECONDARY_PROFILE]);
    await secondLoad;
    first.resolve([DEFAULT_PROFILE]);
    await firstLoad;
    assert.equal(controller.getState().selectedId, SECONDARY_PROFILE.id);
  });

  it('projects profile data without exposing nested configuration', async function () {
    const configured = { ...DEFAULT_PROFILE, config: { password: 'secret' } };
    const { controller } = createController({ profiles: [configured] });
    await controller.load();
    const [profile] = controller.getState().profiles;
    assert.equal(Object.isFrozen(profile), true);
    assert.equal('config' in profile, false);
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

describe('legacy WebDAV profile controller connection lifecycle', function () {
  it('starts a connection check for the initial selection', async function () {
    const tested = [];
    const { controller } = createController({
      profiles: [DEFAULT_PROFILE],
      testProfile: async (id) => { tested.push(id); return { connected: true }; },
    });
    await controller.load();
    await settle();
    assert.deepEqual(tested, [DEFAULT_PROFILE.id]);
    assert.equal(controller.getState().connection.profileId, DEFAULT_PROFILE.id);
    assert.equal(controller.getState().connection.result.connected, true);
  });

  it('remembers a new selection and checks its connection', async function () {
    const tested = [];
    const { controller, storage } = createController({
      profiles: [DEFAULT_PROFILE, SECONDARY_PROFILE],
      testProfile: async (id) => { tested.push(id); return { connected: true }; },
    });
    await controller.load();
    await controller.select(SECONDARY_PROFILE.id);
    assert.equal(controller.getState().selectedId, SECONDARY_PROFILE.id);
    assert.equal(JSON.parse(storage.value()).byType.webdav, SECONDARY_PROFILE.id);
    assert.deepEqual(tested, [DEFAULT_PROFILE.id, SECONDARY_PROFILE.id]);
  });

  it('never publishes a new selection with the previous profile connection', async function () {
    const { controller, states } = createController({
      profiles: [DEFAULT_PROFILE, SECONDARY_PROFILE],
      testProfile: async () => ({ connected: true }),
    });
    await controller.load();
    await settle();
    const boundary = states.length;
    await controller.select(SECONDARY_PROFILE.id);
    const changed = states.slice(boundary).filter((state) => (
      state.selectedId === SECONDARY_PROFILE.id
    ));
    assert.ok(changed.length > 0);
    assert.ok(changed.every((state) => (
      state.connection.profileId === SECONDARY_PROFILE.id
      && state.connection.phase !== 'idle'
    )));
  });

  it('refreshes only the current selection', async function () {
    const tested = [];
    const { controller } = createController({
      profiles: [DEFAULT_PROFILE, SECONDARY_PROFILE],
      testProfile: async (id) => { tested.push(id); return { connected: true }; },
    });
    await controller.load();
    await controller.select(SECONDARY_PROFILE.id);
    tested.length = 0;
    await controller.refresh();
    assert.deepEqual(tested, [SECONDARY_PROFILE.id]);
  });

  it('rejects an unknown connection selection', async function () {
    const { controller } = createController({ profiles: [DEFAULT_PROFILE] });
    await controller.load();
    await assert.rejects(() => controller.select(DISABLED_PROFILE.id), /STORAGE_NOT_WRITABLE/);
    assert.equal(controller.getState().selectedId, DEFAULT_PROFILE.id);
  });

  it('keeps uploads available when a connection check fails', async function () {
    const { controller } = createController({
      profiles: [DEFAULT_PROFILE],
      testProfile: async () => { throw new Error('WEBDAV_UNREACHABLE'); },
    });
    await controller.load();
    await settle();
    assert.equal(controller.getState().connection.phase, 'error');
    assert.equal(controller.getState().connection.error, 'WEBDAV_UNREACHABLE');
    assert.equal(controller.getState().canUpload, true);
  });

  it('prevents a stale connection result from replacing the new selection', async function () {
    const first = deferred();
    const { controller } = createController({
      profiles: [DEFAULT_PROFILE, SECONDARY_PROFILE],
      testProfile: (id) => id === DEFAULT_PROFILE.id
        ? first.promise
        : Promise.resolve({ connected: true, message: 'secondary' }),
    });
    await controller.load();
    await controller.select(SECONDARY_PROFILE.id);
    first.resolve({ connected: false, message: 'stale' });
    await first.promise;
    await settle();
    assert.equal(controller.getState().connection.profileId, SECONDARY_PROFILE.id);
    assert.equal(controller.getState().connection.result.message, 'secondary');
  });
});
