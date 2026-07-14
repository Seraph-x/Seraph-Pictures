{
  'use strict';

  const UPLOAD_PROFILE_MEMORY_KEY = 'seraph-storage-profile-selection:v1';

  function uploadProfileError(code) {
    return Object.assign(new Error(code), { code });
  }

  function snapshotUploadTarget(options) {
    const profile = options.profile;
    if (!profile?.id || profile.type !== options.storageMode || !profile.enabled) {
      throw uploadProfileError('STORAGE_NOT_WRITABLE');
    }
    return Object.freeze({
      storageMode: options.storageMode,
      storageId: profile.id,
      storageName: profile.name,
      folderPath: String(options.folderPath || ''),
    });
  }

  function appendUploadTarget(formData, target) {
    formData.append('storageMode', target.storageMode);
    formData.append('storageId', target.storageId);
    formData.append('folderPath', target.folderPath);
    return formData;
  }

  function buildUrlUploadPayload(options) {
    return Object.freeze({
      url: options.url,
      storageMode: options.target.storageMode,
      storageId: options.target.storageId,
      folderPath: options.target.folderPath,
    });
  }

  function buildMultipartInit(options) {
    return Object.freeze({
      fileName: options.file.name,
      fileSize: options.file.size,
      fileType: options.file.type,
      storageMode: options.target.storageMode,
      storageId: options.target.storageId,
      folderPath: options.target.folderPath,
    });
  }

  function resolveUploadSelection(options) {
    if (options.isGuest) throw uploadProfileError('GUEST_PROFILE_ENUMERATION_FORBIDDEN');
    const choices = (options.profiles || []).filter((profile) => (
      profile.type === options.storageMode && profile.enabled
    ));
    const remembered = choices.find((profile) => profile.id === options.rememberedId);
    if (remembered) return Object.freeze({ profile: remembered, notice: '' });
    const profile = choices.find((item) => item.isDefault);
    if (!profile) throw uploadProfileError('STORAGE_SELECTION_REQUIRED');
    return Object.freeze({
      profile,
      notice: options.rememberedId ? 'STORAGE_PROFILE_SELECTION_RESET' : '',
    });
  }

  function readProfileMemory(storage, type) {
    const raw = storage.getItem(UPLOAD_PROFILE_MEMORY_KEY);
    if (!raw) return '';
    let value;
    try {
      value = JSON.parse(raw);
    } catch (cause) {
      throw Object.assign(uploadProfileError('STORAGE_PROFILE_MEMORY_INVALID'), { cause });
    }
    if (value?.version !== 1 || !value.byType || Array.isArray(value.byType)) {
      throw uploadProfileError('STORAGE_PROFILE_MEMORY_INVALID');
    }
    return String(value.byType[type] || '');
  }

  function rememberProfile(storage, type, id) {
    let byType = {};
    const raw = storage.getItem(UPLOAD_PROFILE_MEMORY_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.version !== 1 || !parsed.byType) throw uploadProfileError('STORAGE_PROFILE_MEMORY_INVALID');
      byType = parsed.byType;
    }
    const value = Object.freeze({ version: 1, byType: Object.freeze({ ...byType, [type]: id }) });
    storage.setItem(UPLOAD_PROFILE_MEMORY_KEY, JSON.stringify(value));
    return value;
  }

  function profileErrorCode(cause) {
    return String(cause?.code || cause?.message || 'STORAGE_PROFILE_LOAD_FAILED');
  }

  function profileMethods(api, storage) {
    return {
      async loadStorageProfiles() {
        if (this.isGuest) return;
        this.storageProfileError = '';
        try {
          this.storageProfiles = Object.freeze(await api.listProfiles());
          this.resolveStorageProfile();
        } catch (cause) {
          this.storageProfiles = Object.freeze([]);
          this.storageId = '';
          this.storageName = '';
          this.storageTarget = '';
          this.storageProfileError = profileErrorCode(cause);
        }
      },
      resolveStorageProfile() {
        const result = resolveUploadSelection({
          profiles: this.storageProfiles,
          storageMode: this.storageMode,
          rememberedId: readProfileMemory(storage, this.storageMode),
          isGuest: this.isGuest,
        });
        this.storageId = result.profile.id;
        this.storageName = result.profile.name;
        this.storageTarget = `${result.profile.type} · ${result.profile.name}`;
        this.storageProfileNotice = result.notice;
        return result.profile;
      },
      selectStorageProfile(id) {
        const profile = this.storageProfiles.find((item) => (
          item.id === id && item.type === this.storageMode && item.enabled
        ));
        if (!profile) throw uploadProfileError('STORAGE_NOT_WRITABLE');
        this.storageId = profile.id;
        this.storageName = profile.name;
        this.storageTarget = `${profile.type} · ${profile.name}`;
        this.storageProfileNotice = '';
        this.storageProfileError = '';
        rememberProfile(storage, this.storageMode, profile.id);
      },
    };
  }

  function createUploadProfileMixin(options) {
    return Object.freeze({
      data: () => ({
        storageProfiles: [], storageId: '', storageName: '',
        storageProfileNotice: '', storageProfileError: '',
      }),
      computed: {
        uploadProfileChoices() {
          return this.storageProfiles.filter((profile) => (
            profile.type === this.storageMode && profile.enabled
          ));
        },
      },
      methods: profileMethods(options.api, options.storage),
    });
  }

  const legacyUploadProfiles = Object.freeze({
    appendUploadTarget, buildMultipartInit, buildUrlUploadPayload,
    createUploadProfileMixin, readProfileMemory, rememberProfile,
    resolveUploadSelection, snapshotUploadTarget,
  });
  if (typeof module === 'object' && module.exports) module.exports = legacyUploadProfiles;
  globalThis.LegacyUploadProfiles = legacyUploadProfiles;
}
