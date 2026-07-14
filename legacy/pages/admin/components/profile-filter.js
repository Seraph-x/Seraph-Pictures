{
  'use strict';
  globalThis.LegacyAdminComponents = globalThis.LegacyAdminComponents || {};
  globalThis.LegacyAdminComponents.profileFilter = `            <select class="admin-profile-filter" data-storage-profile-filter v-model="storageProfileId" @change="setStorageProfileFilter(storageProfileId)">
              <option value="">All backends</option>
              <option v-for="profile in storageProfiles" :key="profile.id" :value="profile.id">
                {{ profile.type }} · {{ profile.name }}{{ profile.enabled ? '' : ' (disabled)' }}
              </option>
            </select>`;
}
