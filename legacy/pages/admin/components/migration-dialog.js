{
  'use strict';
  globalThis.LegacyAdminComponents = globalThis.LegacyAdminComponents || {};
  globalThis.LegacyAdminComponents.migrationDialog = `        <select data-migration-storage-profile v-model="migrationStorageId" :disabled="!selectedFiles.length">
          <option value="">Move to backend...</option>
          <option v-for="profile in migrationProfileChoices" :key="profile.id" :value="profile.id">
            {{ profile.type }} · {{ profile.name }}
          </option>
        </select>
        <el-button class="batch-btn" icon="el-icon-right" :disabled="!selectedFiles.length || !migrationStorageId" @click="migrateSelectedFiles">Migrate</el-button>`;
}
