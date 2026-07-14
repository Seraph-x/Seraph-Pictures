import { ref } from 'vue';

function cloneProfile(item) {
  if (!item) return null;
  return Object.freeze({
    ...item,
    config: Object.freeze({ ...(item.config || {}) }),
  });
}

function createState() {
  return Object.freeze({
    items: ref([]),
    selectedId: ref(''),
    editingItem: ref(null),
    editorRevision: ref(0),
    saving: ref(false),
    testing: ref(false),
    message: ref(''),
    error: ref(''),
    draftTest: ref(null),
    testResults: ref(Object.freeze({})),
  });
}

function errorMessage(error, fallback) {
  return error?.message || fallback;
}

function clearFeedback({ state }) {
  state.message.value = '';
  state.error.value = '';
}

function selectExistingProfile({ state }) {
  const selectedExists = state.items.value.some((item) => item.id === state.selectedId.value);
  if (selectedExists) return;
  const profile = state.items.value.find((item) => item.isDefault) || state.items.value[0];
  state.selectedId.value = profile?.id || '';
}

function syncEditingProfile({ state }) {
  const editingId = state.editingItem.value?.id;
  if (!editingId) return;
  const current = state.items.value.find((item) => item.id === editingId);
  state.editingItem.value = cloneProfile(current);
  state.editorRevision.value += 1;
}

async function refresh(context) {
  const { api, state, t } = context;
  clearFeedback(context);
  try {
    state.items.value = await api.listStorageConfigs();
    selectExistingProfile(context);
    syncEditingProfile(context);
  } catch (cause) {
    state.error.value = errorMessage(cause, t('sv.msgLoadFail'));
  }
}

function openEditor(context, item) {
  const { state } = context;
  state.editingItem.value = cloneProfile(item);
  state.selectedId.value = item?.id || state.selectedId.value;
  state.editorRevision.value += 1;
  state.draftTest.value = null;
  clearFeedback(context);
}

async function refreshPreservingMessage(context) {
  const successMessage = context.state.message.value;
  await refresh(context);
  context.state.message.value = successMessage;
}

function saveRequest(context, payload) {
  const { state } = context;
  if (payload.isDefault && !payload.enabled) throw new Error('STORAGE_NOT_WRITABLE');
  const current = state.editingItem.value;
  const hasSameTypePeer = state.items.value.some((item) => (
    item.type === payload.type && item.id !== current?.id
  ));
  const apiPayload = {
    ...payload,
    isDefault: current?.isDefault || false,
    config: Object.freeze({ ...payload.config }),
  };
  if (!hasSameTypePeer && !current?.isDefault) delete apiPayload.isDefault;
  return Object.freeze({
    apiPayload: Object.freeze(apiPayload),
    currentId: current?.id || '',
    wantsDefault: Boolean(payload.isDefault),
  });
}

async function persistProfile(context, request) {
  const { api } = context;
  return request.currentId
    ? await api.updateStorageConfig(request.currentId, request.apiPayload)
    : await api.createStorageConfig(request.apiPayload);
}

function applySavedProfile({ state }, saved) {
  state.selectedId.value = saved.id;
  state.editingItem.value = cloneProfile(saved);
  state.editorRevision.value += 1;
}

async function saveProfile(context, payload) {
  const { state, t } = context;
  state.saving.value = true;
  clearFeedback(context);
  try {
    const request = saveRequest(context, payload);
    let saved = await persistProfile(context, request);
    applySavedProfile(context, saved);
    if (request.wantsDefault && !saved.isDefault) {
      saved = await context.api.setDefaultStorageConfig(saved.id);
      applySavedProfile(context, saved);
    }
    state.message.value = t(request.currentId ? 'sv.msgUpdated' : 'sv.msgCreated');
    await refreshPreservingMessage(context);
  } catch (cause) {
    const failure = errorMessage(cause, t('sv.msgSaveFail'));
    await refresh(context);
    state.error.value = failure;
  } finally {
    state.saving.value = false;
  }
}

function requireTestResult(result) {
  if (result && typeof result === 'object' && typeof result.connected === 'boolean') return result;
  throw new Error('STORAGE_TEST_RESPONSE_INVALID');
}

async function testDraft(context, payload) {
  const { api, state, t } = context;
  state.testing.value = true;
  clearFeedback(context);
  try {
    const result = requireTestResult(await api.testStorageDraft(payload.type, payload.config));
    state.draftTest.value = Object.freeze({ ...result });
    state.message.value = t(result.connected ? 'sv.msgDraftOk' : 'sv.msgDraftFail');
  } catch (cause) {
    state.draftTest.value = null;
    state.error.value = errorMessage(cause, t('sv.msgConnTestFail'));
  } finally {
    state.testing.value = false;
  }
}

async function testProfile(context, id) {
  const { api, state, t } = context;
  clearFeedback(context);
  try {
    const result = requireTestResult(await api.testStorageConfigById(id));
    state.testResults.value = Object.freeze({
      ...state.testResults.value,
      [id]: Object.freeze({ ...result, testedAt: Date.now() }),
    });
    state.message.value = t(result.connected ? 'sv.msgConnOk' : 'sv.msgConnFail');
  } catch (cause) {
    state.error.value = errorMessage(cause, t('sv.msgTestFail'));
  }
}

async function updateProfile(context, item, payload) {
  const { api, state, t } = context;
  clearFeedback(context);
  try {
    await api.updateStorageConfig(item.id, payload);
    state.message.value = t('sv.msgStatusUpdated');
    await refreshPreservingMessage(context);
  } catch (cause) {
    state.error.value = errorMessage(cause, t('sv.msgUpdateFail'));
  }
}

async function makeDefault(context, id) {
  const { api, state, t } = context;
  clearFeedback(context);
  try {
    await api.setDefaultStorageConfig(id);
    state.message.value = t('sv.msgDefaultUpdated');
    await refreshPreservingMessage(context);
  } catch (cause) {
    state.error.value = errorMessage(cause, t('sv.msgSetDefaultFail'));
  }
}

async function removeProfile(context, item) {
  const { api, confirmDelete, state, t } = context;
  if (!confirmDelete(t('sv.confirmDelete'))) return;
  clearFeedback(context);
  try {
    await api.deleteStorageConfig(item.id);
    if (state.editingItem.value?.id === item.id) openEditor(context, null);
    state.message.value = t('sv.msgDeleted');
    await refreshPreservingMessage(context);
  } catch (cause) {
    state.error.value = errorMessage(cause, t('sv.msgDeleteFail'));
  }
}

function createActions(context) {
  return Object.freeze({
    makeDefault: (id) => makeDefault(context, id),
    openEditor: (item) => openEditor(context, item),
    refresh: () => refresh(context),
    removeProfile: (item) => removeProfile(context, item),
    saveProfile: (payload) => saveProfile(context, payload),
    selectProfile: (id) => { context.state.selectedId.value = id; },
    startCreate: () => openEditor(context, null),
    testDraft: (payload) => testDraft(context, payload),
    testProfile: (id) => testProfile(context, id),
    toggleProfile: (item) => updateProfile(context, item, { enabled: !item.enabled }),
  });
}

export function useStorageProfileEditor(options) {
  const state = createState();
  const context = Object.freeze({ ...options, state });
  return Object.freeze({ ...state, ...createActions(context) });
}
