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

  class WebdavProfileController {
    constructor(options) {
      this.options = options;
      this.state = initialState();
      this.requestToken = 0;
    }

    publish(patch) {
      this.state = freezeState({ ...this.state, ...patch });
      this.options.onChange(this.state);
      return this.state;
    }

    async load() {
      this.publish({ phase: 'loading', error: '', canUpload: false });
      try {
        const listed = await this.options.api.listProfiles();
        const profiles = listed.filter((profile) => profile.type === STORAGE_TYPE && profile.enabled);
        if (!profiles.length) return this.publish({ phase: 'empty', profiles: [], selectedId: '', notice: '' });
        const rememberedId = this.options.selection.readProfileMemory(this.options.storage, STORAGE_TYPE);
        const choice = chooseProfile(profiles, rememberedId);
        const state = this.publish({
          phase: 'ready', profiles, selectedId: choice.selected.id,
          notice: choice.notice, error: '', canUpload: true,
        });
        void this.refresh();
        return state;
      } catch (error) {
        return this.publish({
          phase: 'error', profiles: [], selectedId: '', notice: '',
          error: errorCode(error), canUpload: false,
        });
      }
    }

    async select(id) {
      const profile = this.state.profiles.find((item) => item.id === id);
      if (!profile) throw new Error('STORAGE_NOT_WRITABLE');
      this.options.selection.rememberProfile(this.options.storage, STORAGE_TYPE, profile.id);
      this.publish({ selectedId: profile.id, notice: '', error: '', canUpload: true });
      return this.refresh();
    }

    async refresh() {
      const profileId = this.state.selectedId;
      if (!profileId) return null;
      const token = ++this.requestToken;
      this.publish({ connection: { phase: 'checking', profileId, result: null, error: '' } });
      try {
        const result = await this.options.api.testProfile(profileId);
        if (!this.isCurrent(token, profileId)) return null;
        this.publish({ connection: { phase: 'ready', profileId, result, error: '' } });
        return result;
      } catch (error) {
        if (!this.isCurrent(token, profileId)) return null;
        this.publish({ connection: { phase: 'error', profileId, result: null, error: errorCode(error) } });
        return null;
      }
    }

    isCurrent(token, profileId) {
      return token === this.requestToken && profileId === this.state.selectedId;
    }

    snapshot(folderPath) {
      const profile = this.state.profiles.find((item) => item.id === this.state.selectedId);
      if (!profile) throw new Error('STORAGE_SELECTION_REQUIRED');
      return this.options.selection.snapshotUploadTarget({ storageMode: STORAGE_TYPE, profile, folderPath });
    }

    getState() {
      return this.state;
    }
  }

  function createController(options) {
    return new WebdavProfileController(options);
  }

  const webdavProfiles = Object.freeze({ createController });
  if (typeof module === 'object' && module.exports) module.exports = webdavProfiles;
  globalThis.LegacyWebdavProfiles = webdavProfiles;
}
