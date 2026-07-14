import { computed, ref, watch } from 'vue';
import { apiFetch, getApiBase } from '../../api/client';
import { useUploadQueue } from '../upload/useUploadQueue';
import { humanizeUploadError, useUploadTransport } from '../upload/useUploadTransport';
import { useImageProcessing } from '../useImageProcessing';
import { getStorageLabel, getUploadLimit } from '../../config/storage-definitions';
import { isImageProcessable } from '../../utils/image-processing';
import { createMultipartDigestPlan } from '../../utils/multipart-digest';
import { snapshotStorageTarget } from '../../utils/storage-profile-selection';
import { extractDroppedFiles } from '../../utils/dropped-files';
import { joinPath } from './useDriveMutations';

const CHUNK_SIZE = 5 * 1024 * 1024;
const ACCEPT = 'application/vnd.seraph.v2+json, application/json;q=0.9, text/plain;q=0.5, */*;q=0.1';
const JSON_HEADERS = Object.freeze({
  'Content-Type': 'application/json', Accept: ACCEPT, 'X-Seraph-Client': 'app-v2',
});
const UPLOAD_HEADERS = Object.freeze({ Accept: ACCEPT, 'X-Seraph-Client': 'app-v2' });

function formatSize(bytes = 0) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(index === 0 ? 0 : 2)} ${units[index]}`;
}

function relativeTarget(baseTarget, relativePath) {
  const parent = relativePath.includes('/') ? relativePath.split('/').slice(0, -1).join('/') : '';
  return Object.freeze({
    ...baseTarget,
    targetFolderPath: joinPath(baseTarget.targetFolderPath, parent),
  });
}

function createTransport(t) {
  return useUploadTransport({
    apiFetch, apiUrl: (path) => `${getApiBase()}${path}`, accept: ACCEPT,
    jsonHeaders: JSON_HEADERS, uploadHeaders: UPLOAD_HEADERS, chunkSize: CHUNK_SIZE,
    createDigestPlan: createMultipartDigestPlan, t,
    toAbsoluteUrl: (path) => new URL(path, window.location.origin).toString(),
    onProgress: (item, progress) => { item.progress = progress; },
    onMultipartStart: (item, id) => { item.multipartUploadId = id; },
    onMultipartFinish: (item) => { item.multipartUploadId = null; },
    onRequestStart: (item, xhr) => { item.xhr = xhr; },
    onRequestFinish: (item) => { item.xhr = null; },
  });
}

function enqueueEntries(context, options) {
  for (const entry of options.entries) {
    const created = context.queueController.enqueue(
      [entry.file], relativeTarget(options.target, entry.relativePath || ''), options.imageOptions,
    );
    created[0].relativePath = entry.relativePath || '';
  }
}

function prepareEntries(context, entries) {
  if (!entries.length) return;
  let target;
  try {
    target = context.createTarget();
  } catch (cause) {
    context.error.value = cause.message;
    return;
  }
  const imageCount = entries.filter((entry) => isImageProcessable(entry.file)).length;
  if (imageCount > 0 && context.image.imageUploadDecision.value === 'ask') {
    context.pendingUploadBatch.value = { entries, items: entries, imageCount, target };
    return;
  }
  const decision = imageCount > 0 ? context.image.imageUploadDecision.value : 'original';
  enqueueEntries(context, {
    entries, target,
    imageOptions: context.image.getImageProcessingSnapshotForDecision(decision),
  });
}

function pendingActions(context) {
  function cancelPendingUpload() { context.pendingUploadBatch.value = null; }
  function uploadPending(enabled) {
    const batch = context.pendingUploadBatch.value;
    if (!batch) return;
    context.pendingUploadBatch.value = null;
    enqueueEntries(context, {
      entries: batch.entries, target: batch.target,
      imageOptions: { ...context.image.getImageProcessingSnapshot(), enabled },
    });
  }
  return Object.freeze({
    cancelPendingUpload,
    uploadPendingOriginal: () => uploadPending(false),
    uploadPendingOptimized: () => uploadPending(true),
  });
}

function createState() {
  return {
    dragActive: ref(false), queue: ref([]), results: ref([]), uploading: ref(false),
    urlInput: ref(''), urlUploading: ref(false), pendingUploadBatch: ref(null),
    selectedStorage: ref('telegram'),
  };
}

function createUploadContext(options, state) {
  const { t, profiles, status, currentPath, error } = options;
  const image = useImageProcessing({ formatSize });
  const transport = createTransport(t);
  const selectedStorageId = computed({
    get: () => profiles.selectedProfile(state.selectedStorage.value)?.id || '',
    set: (id) => profiles.select(state.selectedStorage.value, id),
  });
  const createTarget = () => Object.freeze({
    ...snapshotStorageTarget({
      storageMode: state.selectedStorage.value,
      profile: profiles.selectedProfile(state.selectedStorage.value),
      targetFolderPath: currentPath.value,
    }),
    uploadSource: 'drive',
  });
  const queueController = useUploadQueue({
    queue: state.queue, results: state.results, uploading: state.uploading,
    error, profiles: profiles.profiles, status,
    apiFetch, transport, prepareQueuedImage: image.prepareQueuedImage,
    getUploadLimit, formatSize, t, chunkSize: CHUNK_SIZE,
    humanizeError: (message) => humanizeUploadError(message, t),
    createId: () => `${Date.now()}_${Math.random().toString(16).slice(2)}`,
  });
  return Object.freeze({
    t, error, image, transport, queueController,
    pendingUploadBatch: state.pendingUploadBatch, createTarget, selectedStorageId,
  });
}

function uploadActions(options, state, context) {
  async function handleDrop(event) {
    state.dragActive.value = false;
    prepareEntries(context, await extractDroppedFiles(event.dataTransfer));
  }
  function handleFilePick(event) {
    const entries = Array.from(event.target.files || []).map((file) => ({ file, relativePath: '' }));
    prepareEntries(context, entries);
    event.target.value = '';
  }
  async function uploadUrl() {
    if (!state.urlInput.value || state.urlUploading.value) return;
    state.urlUploading.value = true;
    options.error.value = '';
    try {
      await context.transport.uploadUrl({ url: state.urlInput.value, target: context.createTarget() });
      state.urlInput.value = '';
      await options.refreshAll();
    } catch (cause) {
      options.error.value = humanizeUploadError(cause.message || options.t('dv.errUrlUploadFailed'), options.t);
    } finally {
      state.urlUploading.value = false;
    }
  }
  function selectStorageMode(type) {
    state.selectedStorage.value = type;
    options.profiles.resolve(type);
  }
  return Object.freeze({ handleDrop, handleFilePick, uploadUrl, selectStorageMode });
}

export function useDriveUpload(options) {
  const state = createState();
  const context = createUploadContext(options, state);
  const actions = uploadActions(options, state, context);
  watch(() => state.results.value.length, (next, previous) => {
    if (next > previous) void options.refreshAll();
  });
  const pending = pendingActions(context);
  async function cancelUpload(id) {
    options.error.value = '';
    try {
      await context.queueController.cancel(id);
    } catch (cause) {
      options.error.value = cause.message;
    }
  }
  function retryUpload(id) {
    options.error.value = '';
    try {
      context.queueController.retry(id);
    } catch (cause) {
      options.error.value = cause.message;
    }
  }
  return Object.freeze({
    ...state, selectedStorageId: context.selectedStorageId,
    image: context.image, formatSize, ...actions, ...pending,
    cancelUpload, retryUpload,
  });
}
