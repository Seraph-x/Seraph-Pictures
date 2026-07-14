import { computed, readonly, ref } from 'vue';
import { listStorageProfiles } from '../../api/storage';
import {
  enabledProfilesForType,
  readRememberedStorageProfile,
  rememberStorageProfile,
  selectStorageProfile,
} from '../../utils/storage-profile-selection';

export function useStorageProfiles(options = {}) {
  const load = options.load || listStorageProfiles;
  const storage = options.storage || window.localStorage;
  const profiles = ref([]);
  const selectedIds = ref(Object.freeze({}));
  const notice = ref('');
  const loading = ref(false);
  const error = ref(null);

  function choices(type) {
    return enabledProfilesForType(profiles.value, type);
  }

  function selectedProfile(type) {
    const id = selectedIds.value[type];
    return choices(type).find((profile) => profile.id === id) || null;
  }

  function select(type, storageId) {
    const profile = choices(type).find((item) => item.id === storageId);
    if (!profile) throw Object.assign(new Error('STORAGE_NOT_WRITABLE'), { code: 'STORAGE_NOT_WRITABLE' });
    selectedIds.value = Object.freeze({ ...selectedIds.value, [type]: profile.id });
    rememberStorageProfile(storage, type, profile.id);
    notice.value = '';
    return profile;
  }

  function resolve(type) {
    const rememberedId = readRememberedStorageProfile(storage, type);
    const result = selectStorageProfile({ profiles: profiles.value, type, rememberedId });
    selectedIds.value = Object.freeze({ ...selectedIds.value, [type]: result.profile.id });
    notice.value = result.notice;
    return result.profile;
  }

  async function refresh() {
    loading.value = true;
    error.value = null;
    try {
      profiles.value = Object.freeze(await load());
      return profiles.value;
    } catch (cause) {
      error.value = cause;
      throw cause;
    } finally {
      loading.value = false;
    }
  }

  return Object.freeze({
    profiles: readonly(profiles),
    selectedIds: readonly(selectedIds),
    notice: readonly(notice),
    loading: readonly(loading),
    error: readonly(error),
    hasProfiles: computed(() => profiles.value.length > 0),
    choices,
    selectedProfile,
    select,
    resolve,
    refresh,
  });
}
