import { computed, ref } from 'vue';

function sortTree(nodes) {
  const entries = nodes.map((node) => ({ node, segments: node.path ? node.path.split('/') : [] }));
  return entries.sort((left, right) => compareSegments(left.segments, right.segments)).map(({ node }) => node);
}

function compareSegments(left, right) {
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    const order = left[index].localeCompare(right[index], 'en', { sensitivity: 'base' })
      || left[index].localeCompare(right[index], 'en');
    if (order) return order;
  }
  return left.length - right.length;
}

function pathBreadcrumbs(path, t) {
  const parts = path ? path.split('/') : [];
  return [
    { path: '', name: t('dv.allFiles') },
    ...parts.map((name, index) => ({ path: parts.slice(0, index + 1).join('/'), name })),
  ];
}

function applyPage(context, data, reset) {
  const { state, t } = context;
  const incoming = Array.isArray(data.files) ? data.files : [];
  if (reset) {
    state.folders.value = Array.isArray(data.folders) ? data.folders : [];
    state.breadcrumbs.value = Array.isArray(data.breadcrumbs)
      ? data.breadcrumbs : pathBreadcrumbs(state.currentPath.value, t);
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
  state.explorerError.value = '';
  context.requests.reset = reset;
  try {
    const data = await api.getDriveExplorer({
      ...context.requests.query,
      cursor: reset ? '' : (state.nextCursor.value || ''),
      includeStats: reset,
    });
    if (requestId === context.requests.latest) applyPage(context, data, reset);
  } catch (cause) {
    if (requestId === context.requests.latest) {
      state.explorerError.value = cause.message || t('dv.errLoadExplorer');
    }
  } finally {
    if (requestId === context.requests.latest) state.loading.value = false;
  }
}

async function loadTree(context) {
  const { state, requests, api, t } = context;
  const requestId = ++requests.tree;
  state.treeLoading.value = true;
  state.treeError.value = '';
  state.treeNodes.value = [];
  try {
    const nodes = await api.getDriveTree({ storageId: state.storageId.value });
    if (requestId === requests.tree) state.treeNodes.value = nodes;
  } catch (cause) {
    if (requestId === requests.tree) state.treeError.value = cause.message || t('dv.errLoadTree');
  } finally {
    if (requestId === requests.tree) state.treeLoading.value = false;
  }
}

function createState(t) {
  return {
    treeNodes: ref([]), folders: ref([]), files: ref([]),
    breadcrumbs: ref([{ path: '', name: t('dv.allFiles') }]),
    currentPath: ref(''), storageId: ref(''), search: ref(''),
    appliedSearch: ref(''), explorerError: ref(''), treeError: ref(''), treeLoading: ref(false),
    nextCursor: ref(null), loading: ref(false), viewMode: ref('list'),
    selectedFileIds: ref([]), error: ref(''),
  };
}

function resetExplorer(context) {
  const { state, requests, t } = context;
  requests.query = Object.freeze({
    path: state.currentPath.value, storageId: state.storageId.value, search: state.search.value.trim(),
  });
  state.appliedSearch.value = requests.query.search;
  state.nextCursor.value = null;
  state.files.value = [];
  state.folders.value = [];
  state.selectedFileIds.value = [];
  state.breadcrumbs.value = pathBreadcrumbs(state.currentPath.value, t);
  return loadExplorer(context, true);
}

function navigationActions(context) {
  const { state, requests } = context;
  const reloadExplorer = () => resetExplorer(context);
  async function refreshAll() {
    await Promise.all([loadTree(context), reloadExplorer()]);
  }
  function openPath(path) {
    state.currentPath.value = path || '';
    return reloadExplorer();
  }
  function loadMore() {
    if (state.loading.value || !state.nextCursor.value) return;
    return loadExplorer(context, false);
  }
  function retryExplorer() {
    if (state.loading.value || !requests.query) return;
    return loadExplorer(context, requests.reset);
  }
  return { refreshAll, reloadExplorer, reloadTree: () => loadTree(context), openPath, loadMore, retryExplorer };
}

export function useDriveExplorer(options) {
  const state = createState(options.t);
  const context = Object.freeze({
    state, api: options.api, t: options.t, requests: { latest: 0, tree: 0, query: null, reset: true },
  });
  const selectedSet = computed(() => new Set(state.selectedFileIds.value));
  const allSelected = computed(() => (
    state.files.value.length > 0 && state.files.value.every((file) => selectedSet.value.has(file.name))
  ));
  const flatTreeNodes = computed(() => sortTree(state.treeNodes.value).map((node) => ({
    ...node, depth: node.path ? node.path.split('/').length : 0,
  })));

  function toggleFileSelection(id) {
    if (!state.files.value.some((file) => file.name === id)) return;
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
    ...navigationActions(context), toggleFileSelection, toggleSelectAll,
  });
}
