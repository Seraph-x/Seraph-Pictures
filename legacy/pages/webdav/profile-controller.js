{
  'use strict';

  const STORAGE_TYPE = 'webdav';

  function freezeProfiles(profiles) {
    return Object.freeze(profiles.map((profile) => Object.freeze({ ...profile })));
  }

  function idleConnection() {
    return Object.freeze({ phase: 'idle', profileId: '', result: null, error: '' });
  }

  function freezeState(state) {
    return Object.freeze({
      ...state,
      profiles: freezeProfiles(state.profiles || []),
      connection: Object.freeze({ ...(state.connection || idleConnection()) }),
    });
  }

  function initialState() {
    return freezeState({
      phase: 'idle', profiles: [], selectedId: '', notice: '', error: '',
      canUpload: false, connection: idleConnection(),
    });
  }

  function chooseProfile(profiles, rememberedId) {
    const remembered = profiles.find((profile) => profile.id === rememberedId);
    const selected = remembered || profiles.find((profile) => profile.isDefault) || profiles[0];
    return Object.freeze({
      selected,
      notice: rememberedId && !remembered ? 'STORAGE_PROFILE_SELECTION_RESET' : '',
    });
  }

  function errorCode(error) {
    return String(error?.code || error?.message || 'STORAGE_PROFILE_LOAD_FAILED');
  }

  function createController(options) {
    let state = initialState();

    function publish(patch) {
      state = freezeState({ ...state, ...patch });
      options.onChange(state);
      return state;
    }

    async function load() {
      publish({ phase: 'loading', error: '', canUpload: false });
      try {
        const listed = await options.api.listProfiles();
        const profiles = listed.filter((profile) => profile.type === STORAGE_TYPE && profile.enabled);
        if (!profiles.length) return publish({ phase: 'empty', profiles: [], selectedId: '', notice: '' });
        const rememberedId = options.selection.readProfileMemory(options.storage, STORAGE_TYPE);
        const choice = chooseProfile(profiles, rememberedId);
        return publish({
          phase: 'ready', profiles, selectedId: choice.selected.id,
          notice: choice.notice, error: '', canUpload: true,
        });
      } catch (error) {
        return publish({
          phase: 'error', profiles: [], selectedId: '', notice: '',
          error: errorCode(error), canUpload: false,
        });
      }
    }

    function snapshot(folderPath) {
      const profile = state.profiles.find((item) => item.id === state.selectedId);
      if (!profile) throw new Error('STORAGE_SELECTION_REQUIRED');
      return options.selection.snapshotUploadTarget({ storageMode: STORAGE_TYPE, profile, folderPath });
    }

    return Object.freeze({ load, snapshot, getState: () => state });
  }

  const webdavProfiles = Object.freeze({ createController });
  if (typeof module === 'object' && module.exports) module.exports = webdavProfiles;
  globalThis.LegacyWebdavProfiles = webdavProfiles;
}
