import { computed, readonly, ref } from 'vue';
import { listStorageProfiles } from '../../api/storage';
import {
  enabledProfilesForType,
  readRememberedStorageProfile,
  rememberStorageProfile,
  selectStorageProfile,
} from '../../utils/storage-profile-selection';

function createState(options) {
  return Object.freeze({
    load: options.load || listStorageProfiles,
    storage: options.storage || window.localStorage,
    profiles: ref([]),
    selectedIds: ref(Object.freeze({})),
    notice: ref(''),
    loading: ref(false),
    error: ref(null),
  });
}

function choices(state, type) {
  return enabledProfilesForType(state.profiles.value, type);
}

function selectedProfile(state, type) {
  const id = state.selectedIds.value[type];
  return choices(state, type).find((profile) => profile.id === id) || null;
}

function select(state, type, storageId) {
  const profile = choices(state, type).find((item) => item.id === storageId);
  if (!profile) throw Object.assign(new Error('STORAGE_NOT_WRITABLE'), { code: 'STORAGE_NOT_WRITABLE' });
  state.selectedIds.value = Object.freeze({ ...state.selectedIds.value, [type]: profile.id });
  rememberStorageProfile(state.storage, type, profile.id);
  state.notice.value = '';
  return profile;
}

function resolve(state, type) {
  const rememberedId = readRememberedStorageProfile(state.storage, type);
  const result = selectStorageProfile({ profiles: state.profiles.value, type, rememberedId });
  state.selectedIds.value = Object.freeze({ ...state.selectedIds.value, [type]: result.profile.id });
  state.notice.value = result.notice;
  return result.profile;
}

async function refresh(state) {
  state.loading.value = true;
  state.error.value = null;
  try {
    state.profiles.value = Object.freeze(await state.load());
    return state.profiles.value;
  } catch (cause) {
    state.error.value = cause;
    throw cause;
  } finally {
    state.loading.value = false;
  }
}

function publicApi(state) {
  return Object.freeze({
    profiles: readonly(state.profiles),
    selectedIds: readonly(state.selectedIds),
    notice: readonly(state.notice),
    loading: readonly(state.loading),
    error: readonly(state.error),
    hasProfiles: computed(() => state.profiles.value.length > 0),
    choices: (type) => choices(state, type),
    selectedProfile: (type) => selectedProfile(state, type),
    select: (type, storageId) => select(state, type, storageId),
    resolve: (type) => resolve(state, type),
    refresh: () => refresh(state),
  });
}

export function useStorageProfiles(options = {}) {
  return publicApi(createState(options));
}
