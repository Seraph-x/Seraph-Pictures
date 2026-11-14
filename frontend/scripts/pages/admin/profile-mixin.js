{
  'use strict';

  function buildProfileQuery(options = {}) {
    const query = new URLSearchParams();
    if (options.storageId) query.set('storageId', options.storageId);
    return query;
  }

  function migrationTargets(options) {
    const sourceIds = new Set(options.sourceIds || []);
    return Object.freeze((options.profiles || []).filter((profile) => (
      profile.enabled && !sourceIds.has(profile.id)
    )));
  }

  function profileLabel(file) {
    const metadata = file?.metadata || file || {};
    const type = String(metadata.storageType || metadata.storage || '');
    const name = String(metadata.storageName || metadata.storageId || '');
    return name ? `${type} · ${name}` : type;
  }

  function createAdminProfileMixin(options) {
    const api = options.api;
    return Object.freeze({
      data() {
        return {
          storageProfiles: [],
          storageProfileId: '',
          migrationStorageId: '',
        };
      },
      computed: {
        selectedStorageProfile() {
          return this.storageProfiles.find((item) => item.id === this.storageProfileId) || null;
        },
        migrationProfileChoices() {
          const sources = this.selectedFiles.map((file) => file.metadata?.storageId).filter(Boolean);
          return migrationTargets({ profiles: this.storageProfiles, sourceIds: sources });
        },
      },
      methods: {
        async loadStorageProfiles() {
          this.storageProfiles = Object.freeze(await api.listProfiles());
        },
        setStorageProfileFilter(id) {
          if (id && !this.storageProfiles.some((item) => item.id === id)) {
            throw new Error('STORAGE_PROFILE_NOT_FOUND');
          }
          this.storageProfileId = id;
          this.storageFilter = 'all';
          this.currentPage = 1;
          this.refreshFileList();
        },
        getProfileLabel: profileLabel,
      },
    });
  }

  const legacyAdminProfiles = Object.freeze({
    buildProfileQuery, createAdminProfileMixin, migrationTargets, profileLabel,
  });
  if (typeof module === 'object' && module.exports) module.exports = legacyAdminProfiles;
  globalThis.LegacyAdminProfiles = legacyAdminProfiles;
}
