{
  'use strict';
  globalThis.LegacyAdminComponents = globalThis.LegacyAdminComponents || {};
  globalThis.LegacyAdminComponents.profileFilter = `            <select class="admin-profile-filter" data-storage-profile-filter :aria-label="t('admin.storageInstance')" v-model="storageProfileId" @change="setStorageProfileFilter(storageProfileId)">
              <option value="">{{ t('admin.allInstances') }}</option>
              <option v-for="profile in storageProfiles" :key="profile.id" :value="profile.id">
                {{ profile.type }} · {{ profile.name }}{{ profile.enabled ? '' : ' (' + t('admin.instanceDisabled') + ')' }}
              </option>
            </select>`;
}
