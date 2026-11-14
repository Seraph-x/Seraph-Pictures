{
  'use strict';

  const storageSelection = globalThis.LegacyStorageSelection
    || (typeof require === 'function' ? require('./selection.js') : null);
  const STORAGE_TYPES = Object.freeze(['telegram', 'r2', 's3', 'discord', 'huggingface', 'webdav', 'github']);

  function storageFreezeMap(value) {
    return Object.freeze({ ...(value || {}) });
  }

  function storageCloneProfiles(items) {
    return Object.freeze((items || []).map(storageSelection.cloneProfile));
  }

  function storageInitialState() {
    return Object.freeze({
      profiles: Object.freeze([]), selectedByType: Object.freeze({}),
      modes: Object.freeze({}), drafts: Object.freeze({}), errors: Object.freeze({}),
      results: Object.freeze({}),
      guest: Object.freeze({ schema: [], config: {}, secretsPresent: {} }),
      globalError: '',
    });
  }

  class LegacyStorageSettingsController {
    constructor(options) {
      this.api = options.api;
      this.renderer = options.renderer;
      this.confirmDelete = options.confirmDelete || (() => true);
      this.state = storageInitialState();
      this.dispatch = this.dispatch.bind(this);
    }

    replace(patch) {
      this.state = Object.freeze({ ...this.state, ...patch });
      this.render();
      return this.state;
    }

    render() {
      const cards = STORAGE_TYPES.map((type) => {
        const typeSelection = storageSelection.buildTypeSelection({
          profiles: this.state.profiles,
          type,
          selectedId: this.state.selectedByType[type],
        });
        return Object.freeze({
          ...typeSelection,
          mode: this.state.modes[type] || 'view',
          draft: this.state.drafts[type] || null,
          result: this.state.results[typeSelection.selected?.id] || null,
        });
      });
      this.renderer.render(Object.freeze({
        cards: Object.freeze(cards), errors: this.state.errors,
        guest: this.state.guest, globalError: this.state.globalError,
      }));
    }

    patchType(map, type, value) {
      return storageFreezeMap({ ...map, [type]: value });
    }

    showError(type, error) {
      const message = error?.code || error?.message || String(error);
      this.replace({ errors: this.patchType(this.state.errors, type, message) });
    }

    clearError(type) {
      this.replace({ errors: this.patchType(this.state.errors, type, '') });
    }

    profileById(id) {
      return this.state.profiles.find((profile) => profile.id === id) || null;
    }

    requireProfile(event) {
      const profile = this.profileById(event.id || this.state.selectedByType[event.type]);
      if (!profile || profile.type !== event.type) throw new Error('STORAGE_PROFILE_NOT_FOUND');
      return profile;
    }

    fail(event, code) {
      const error = new Error(code);
      this.showError(event.type, error);
      return Promise.reject(error);
    }

    selectProfile(event) {
      const profile = this.requireProfile(event);
      this.replace({
        selectedByType: this.patchType(this.state.selectedByType, event.type, profile.id),
        modes: this.patchType(this.state.modes, event.type, 'view'),
        errors: this.patchType(this.state.errors, event.type, ''),
      });
    }

    editProfile(event) {
      const profile = this.requireProfile(event);
      this.replace({
        modes: this.patchType(this.state.modes, event.type, 'edit'),
        drafts: this.patchType(this.state.drafts, event.type, storageSelection.cloneProfile(profile)),
        errors: this.patchType(this.state.errors, event.type, ''),
      });
    }

    addProfile(event) {
      const defaults = event.type === 'r2'
        ? { adapterMode: 'binding' }
        : (event.type === 'github' ? { mode: 'releases' } : {});
      const draft = Object.freeze({
        id: '', name: '', type: event.type, enabled: true, isDefault: false,
        config: Object.freeze(defaults), secretsPresent: Object.freeze({}),
      });
      this.replace({
        modes: this.patchType(this.state.modes, event.type, 'create'),
        drafts: this.patchType(this.state.drafts, event.type, draft),
        errors: this.patchType(this.state.errors, event.type, ''),
      });
    }

    cancel(event) {
      this.replace({ modes: this.patchType(this.state.modes, event.type, 'view') });
    }

    async reloadProfiles(preferredId = '') {
      const profiles = storageCloneProfiles(await this.api.listProfiles());
      let selectedByType = storageSelection.reconcileSelections({
        profiles, types: STORAGE_TYPES, selectedByType: this.state.selectedByType,
      });
      const preferred = profiles.find((item) => item.id === preferredId);
      if (preferred) selectedByType = this.patchType(selectedByType, preferred.type, preferred.id);
      this.replace({ profiles, selectedByType });
    }

    async execute(event, operation) {
      this.clearError(event.type);
      try {
        const result = await operation();
        await this.reloadProfiles(result?.id || event.id);
        return result;
      } catch (error) {
        this.showError(event.type, error);
        throw error;
      }
    }

    saveProfile(event) {
      const current = this.state.drafts[event.type];
      const payload = Object.freeze({
        ...event.payload, type: event.type, enabled: current?.enabled !== false,
        config: Object.freeze({ ...(event.payload?.config || {}) }),
      });
      return this.execute(event, async () => {
        const saved = current?.id
          ? await this.api.updateProfile(current.id, payload)
          : await this.api.createProfile(payload);
        this.replace({
          modes: this.patchType(this.state.modes, event.type, 'view'),
          drafts: this.patchType(this.state.drafts, event.type, null),
        });
        return saved;
      });
    }

    toggleProfile(event) {
      const profile = this.requireProfile(event);
      if (profile.isDefault) return this.fail(event, 'STORAGE_DEFAULT_LOCKED');
      return this.execute(event, () => this.api.updateProfile(profile.id, { enabled: !profile.enabled }));
    }

    defaultProfile(event) {
      const profile = this.requireProfile(event);
      if (!profile.enabled) return this.fail(event, 'STORAGE_PROFILE_DISABLED');
      return this.execute(event, () => this.api.setDefault(profile.id));
    }

    deleteProfile(event) {
      const profile = this.requireProfile(event);
      if (profile.isDefault) return this.fail(event, 'STORAGE_DEFAULT_LOCKED');
      if (!this.confirmDelete(profile.name)) return Promise.resolve(null);
      return this.execute(event, () => this.api.deleteProfile(profile.id));
    }

    async testProfile(event) {
      const profile = this.requireProfile(event);
      this.clearError(event.type);
      try {
        const result = await this.api.testProfile(profile.id);
        this.replace({
          results: this.patchType(this.state.results, profile.id, Object.freeze({ ...result })),
        });
        return result;
      } catch (error) {
        this.showError(event.type, error);
        throw error;
      }
    }

    async saveGuest(event) {
      try {
        const saved = await this.api.saveGuestConfig(event.payload);
        const guest = Object.freeze({ ...this.state.guest, ...saved });
        this.replace({ guest, globalError: '' });
        return guest;
      } catch (error) {
        this.replace({ globalError: error?.code || error?.message || String(error) });
        throw error;
      }
    }

    async loadAll() {
      const [profiles, guest] = await Promise.all([
        this.api.listProfiles(), this.api.loadGuestConfig(),
      ]);
      const frozenProfiles = storageCloneProfiles(profiles);
      this.replace({
        profiles: frozenProfiles,
        selectedByType: storageSelection.reconcileSelections({
          profiles: frozenProfiles, types: STORAGE_TYPES,
          selectedByType: this.state.selectedByType,
        }),
        guest: Object.freeze(guest), globalError: '',
      });
    }

    dispatch(event) {
      const actions = {
        select: 'selectProfile', add: 'addProfile', edit: 'editProfile', cancel: 'cancel',
        save: 'saveProfile', toggle: 'toggleProfile', default: 'defaultProfile',
        delete: 'deleteProfile', test: 'testProfile', 'guest-save': 'saveGuest', reload: 'loadAll',
      };
      const method = actions[event.action];
      if (!method) throw new Error('STORAGE_UI_ACTION_UNSUPPORTED');
      return this[method](event);
    }

    async start() {
      this.renderer.bind(this.dispatch);
      try {
        await this.loadAll();
      } catch (error) {
        this.replace({ globalError: error?.code || error?.message || String(error) });
        throw error;
      }
    }
  }

  function createSettingsController(options) {
    return new LegacyStorageSettingsController(options);
  }

  const legacyStorageController = Object.freeze({ createSettingsController });
  if (typeof module === 'object' && module.exports) module.exports = legacyStorageController;
  globalThis.LegacyStorageController = legacyStorageController;
}
