{
  'use strict';
  globalThis.LegacyUploadComponents = globalThis.LegacyUploadComponents || {};
  globalThis.LegacyUploadComponents.storageTargetPicker = `          <div class="storage-profile-picker" v-if="!isGuest">
            <label for="legacy-upload-storage-profile">Storage backend</label>
            <select id="legacy-upload-storage-profile" data-storage-profile-select v-model="storageId" @change="selectStorageProfile(storageId)">
              <option v-for="profile in uploadProfileChoices" :key="profile.id" :value="profile.id">
                {{ profile.type }} · {{ profile.name }}
              </option>
            </select>
            <div class="storage-profile-notice" v-if="storageProfileNotice" role="status">
              The saved backend is unavailable. The default backend is selected.
            </div>
          </div>`;
}
