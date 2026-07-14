import { computed, ref } from 'vue';

export function normalizeFolderPath(value) {
  const segments = [];
  for (const piece of String(value || '').replace(/\\/g, '/').split('/')) {
    const part = piece.trim();
    if (!part || part === '.') continue;
    if (part === '..') segments.pop();
    else segments.push(part);
  }
  return segments.join('/');
}

function createState() {
  return Object.freeze({
    folderTree: ref([]), folderLoading: ref(false), folderLoadError: ref(''),
    folderLoadNotice: ref(''), targetFolderPath: ref(''), requestId: ref(0),
  });
}

function sortFolderNodes(nodes) {
  return [...nodes].filter((node) => normalizeFolderPath(node.path)).sort((a, b) => {
    const pathA = normalizeFolderPath(a.path);
    const pathB = normalizeFolderPath(b.path);
    return pathA.split('/').length - pathB.split('/').length
      || pathA.localeCompare(pathB, 'en', { sensitivity: 'base' });
  });
}

function folderOptions(context) {
  const { state, t } = context;
  const options = [{ value: '', label: t('uv.rootSlash') }];
  const seen = new Set(['']);
  for (const node of sortFolderNodes(state.folderTree.value)) {
    const path = normalizeFolderPath(node.path);
    if (!path || seen.has(path)) continue;
    seen.add(path);
    options.push({ value: path, label: `/${path}` });
  }
  const target = state.targetFolderPath.value;
  if (target && !seen.has(target)) {
    options.splice(1, 0, { value: target, label: `/${target} ${t('uv.customSuffix')}` });
  }
  return options;
}

function targetExists({ state }) {
  const target = state.targetFolderPath.value;
  return !target || state.folderTree.value.some((node) => normalizeFolderPath(node.path) === target);
}

function folderHint(context) {
  const { state, t } = context;
  if (state.folderLoading.value) return t('uv.hintRefreshing');
  if (state.folderLoadNotice.value) return state.folderLoadNotice.value;
  if (!state.targetFolderPath.value) return t('uv.hintEmptyPath');
  return targetExists(context) ? t('uv.hintExists') : t('uv.hintNewPath');
}

function createView(context) {
  const { state, t } = context;
  return Object.freeze({
    folderBrowserAvailable: computed(() => state.folderTree.value.some((node) => normalizeFolderPath(node.path))),
    folderHint: computed(() => folderHint(context)),
    folderLoadError: state.folderLoadError,
    folderLoading: state.folderLoading,
    folderOptions: computed(() => folderOptions(context)),
    targetFolderBadge: computed(() => {
      if (!state.targetFolderPath.value) return t('uv.badgeRoot');
      return targetExists(context) ? t('uv.badgeExisting') : t('uv.badgeCustom');
    }),
    targetFolderExists: computed(() => targetExists(context)),
    targetFolderPath: state.targetFolderPath,
    targetFolderPathModel: computed({
      get: () => state.targetFolderPath.value,
      set: (value) => { state.targetFolderPath.value = normalizeFolderPath(value); },
    }),
  });
}

async function loadFolderTree(context) {
  const { getDriveTree, selectedStorage, state, t } = context;
  const currentRequest = ++state.requestId.value;
  state.folderLoading.value = true;
  state.folderLoadError.value = '';
  state.folderLoadNotice.value = '';
  try {
    const nodes = await getDriveTree(selectedStorage.value);
    if (currentRequest !== state.requestId.value) return;
    state.folderTree.value = Array.isArray(nodes) ? nodes : [];
    if (state.folderTree.value.length <= 1) state.folderLoadNotice.value = t('uv.noticeNoFolders');
  } catch (cause) {
    if (currentRequest !== state.requestId.value) return;
    state.folderTree.value = [];
    if (cause?.status === 401 || cause?.status === 403) state.folderLoadNotice.value = t('uv.noticeBrowserUnavailable');
    else state.folderLoadError.value = cause.message || t('uv.errLoadFolders');
  } finally {
    if (currentRequest === state.requestId.value) state.folderLoading.value = false;
  }
}

export function useUploadFolders(options) {
  const state = createState();
  const context = Object.freeze({ ...options, state });
  return Object.freeze({
    ...createView(context),
    formatFolderPath: (path) => normalizeFolderPath(path) ? `/${normalizeFolderPath(path)}` : options.t('uv.rootSlash'),
    loadFolderTree: () => loadFolderTree(context),
    reloadFolderTree: () => loadFolderTree(context),
    setTargetFolder: (path) => { state.targetFolderPath.value = normalizeFolderPath(path); },
  });
}
