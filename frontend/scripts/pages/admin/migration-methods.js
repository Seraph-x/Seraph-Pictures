{
  'use strict';

  function selectedFileIds(files) {
    return Object.freeze((files || []).map((file) => String(file.name || file.id || '')).filter(Boolean));
  }

  function createMigrationMixin(options) {
    const api = options.api;
    return Object.freeze({
      methods: {
        async migrateSelectedFiles() {
          const ids = selectedFileIds(this.selectedFiles);
          if (!ids.length) throw new Error('MIGRATION_SOURCE_REQUIRED');
          if (!this.migrationStorageId) throw new Error('MIGRATION_DESTINATION_REQUIRED');
          await api.migrateFiles(ids, this.migrationStorageId);
          this.clearSelection();
          await this.refreshFileList({ syncFolders: true, force: true });
        },
      },
    });
  }

  const legacyAdminMigration = Object.freeze({ createMigrationMixin, selectedFileIds });
  if (typeof module === 'object' && module.exports) module.exports = legacyAdminMigration;
  globalThis.LegacyAdminMigration = legacyAdminMigration;
}
