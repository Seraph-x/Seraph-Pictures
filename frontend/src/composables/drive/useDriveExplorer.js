import { computed, ref } from 'vue';

function sortTree(nodes) {
  return [...nodes].sort((left, right) => {
    const leftDepth = left.path ? left.path.split('/').length : 0;
    const rightDepth = right.path ? right.path.split('/').length : 0;
    if (leftDepth !== rightDepth) return leftDepth - rightDepth;
    return String(left.path || '').localeCompare(String(right.path || ''), 'en', { sensitivity: 'base' });
  });
}

function applyPage(context, data, reset) {
  const { state, t } = context;
  state.folders.value = Array.isArray(data.folders) ? data.folders : [];
  state.breadcrumbs.value = Array.isArray(data.breadcrumbs)
    ? data.breadcrumbs
    : [{ path: '', name: t('dv.allFiles') }];
  const incoming = Array.isArray(data.files) ? data.files : [];
  if (reset) {
    state.files.value = incoming;
    state.selectedFileIds.value = [];
  } else {
    const seen = new Set(state.files.value.map((item) => item.name));
    state.files.value = [...state.files.value, ...incoming.filter((item) => !seen.has(item.name))];
  }
  state.nextCursor.value = data.list_complete ? null : data.cursor;
}

async function loadExplorer(context, reset) {
  const { state, api, t } = context;
  const requestId = context.requests.latest + 1;
  context.requests.latest = requestId;
  state.loading.value = true;
  state.error.value = '';
  try {
    const data = await api.getDriveExplorer({
      path: state.currentPath.value,
      storageId: state.storageId.value,
      search: state.search.value,
      cursor: reset ? '' : (state.nextCursor.value || ''),
      includeStats: reset,
    });
    if (requestId === context.requests.latest) applyPage(context, data, reset);
  } catch (cause) {
    if (requestId === context.requests.latest) {
      state.error.value = cause.message || t('dv.errLoadExplorer');
    }
  } finally {
    if (requestId === context.requests.latest) state.loading.value = false;
  }
}

async function loadTree(context) {
  try {
    context.state.treeNodes.value = await context.api.getDriveTree({
      storageId: context.state.storageId.value,
    });
  } catch (cause) {
    context.state.error.value = cause.message || context.t('dv.errLoadTree');
  }
}

function createState(t) {
  return {
    treeNodes: ref([]), folders: ref([]), files: ref([]),
    breadcrumbs: ref([{ path: '', name: t('dv.allFiles') }]),
    currentPath: ref(''), storageId: ref(''), search: ref(''),
    nextCursor: ref(null), loading: ref(false), viewMode: ref('list'),
    selectedFileIds: ref([]), error: ref(''),
  };
}

export function useDriveExplorer(options) {
  const state = createState(options.t);
  const context = Object.freeze({
    state, api: options.api, t: options.t, requests: { latest: 0 },
  });
  const selectedSet = computed(() => new Set(state.selectedFileIds.value));
  const allSelected = computed(() => (
    state.files.value.length > 0 && state.selectedFileIds.value.length === state.files.value.length
  ));
  const flatTreeNodes = computed(() => sortTree(state.treeNodes.value).map((node) => ({
    ...node, depth: node.path ? node.path.split('/').length : 0,
  })));

  function reloadExplorer() {
    state.nextCursor.value = null;
    return loadExplorer(context, true);
  }
  async function refreshAll() {
    await Promise.all([loadTree(context), reloadExplorer()]);
  }
  function openPath(path) {
    state.currentPath.value = path || '';
    void reloadExplorer();
  }
  function toggleFileSelection(id) {
    state.selectedFileIds.value = selectedSet.value.has(id)
      ? state.selectedFileIds.value.filter((item) => item !== id)
      : [...state.selectedFileIds.value, id];
  }
  function toggleSelectAll() {
    state.selectedFileIds.value = allSelected.value
      ? []
      : state.files.value.map((file) => file.name);
  }
  return Object.freeze({
    ...state, selectedSet, allSelected, flatTreeNodes,
    refreshAll, reloadExplorer, loadMore: () => loadExplorer(context, false),
    openPath, toggleFileSelection, toggleSelectAll,
  });
}
