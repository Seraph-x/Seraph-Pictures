<template>
  <section class="card panel">
    <div class="panel-head">
      <h2>{{ t('uv.title') }}</h2>
      <div class="storage-group">
        <button
          v-for="mode in modes"
          :key="mode.value"
          class="chip"
          :class="{ active: selectedStorage === mode.value, disabled: !mode.available }"
          :disabled="!mode.available"
          :title="mode.hint"
          @click="selectedStorage = mode.value"
        >
          {{ mode.label }}
        </button>
      </div>
    </div>

    <div
      class="dropzone"
      :class="{ active: dragActive }"
      @dragover.prevent="dragActive = true"
      @dragleave.prevent="dragActive = false"
      @drop.prevent="handleDrop"
      @click="openPicker"
    >
      <input ref="picker" type="file" multiple hidden @change="handleFilePick" />
      <p class="dropzone-title">{{ t('uv.dropTitle') }}</p>
      <p class="muted">{{ t('uv.currentTarget') }} {{ currentStorageLabel }} · {{ formatFolderPath(targetFolderPath) }}</p>
    </div>

    <section class="target-directory card-lite">
      <div class="target-directory-head">
        <div>
          <h3>{{ t('uv.targetDir') }}</h3>
          <p class="muted">{{ t('uv.targetDirDesc') }}</p>
        </div>
        <div class="target-directory-actions">
          <button class="btn btn-ghost" type="button" :disabled="folderLoading" @click="reloadFolderTree">
            {{ folderLoading ? t('uv.refreshing') : t('uv.refreshFolders') }}
          </button>
          <button class="btn btn-ghost" type="button" @click="setTargetFolder('')">{{ t('uv.useRoot') }}</button>
        </div>
      </div>

      <div class="target-directory-grid">
        <label class="target-directory-field">
          <span>{{ t('uv.folderBrowser') }}</span>
          <select
            v-model="targetFolderPathModel"
            :disabled="folderLoading || !folderBrowserAvailable"
          >
            <option
              v-for="option in folderOptions"
              :key="option.value || '__root__'"
              :value="option.value"
            >
              {{ option.label }}
            </option>
          </select>
        </label>

        <label class="target-directory-field">
          <span>{{ t('uv.manualPath') }}</span>
          <input
            v-model.trim="targetFolderPathModel"
            placeholder="assets/images/2026"
          />
        </label>
      </div>

      <div class="target-directory-meta">
        <span class="badge" :class="targetFolderExists ? 'badge-ok' : ''">{{ targetFolderBadge }}</span>
        <span class="muted">{{ t('uv.currentFolder') }} {{ formatFolderPath(targetFolderPath) }}</span>
      </div>

      <p class="muted">{{ folderHint }}</p>
      <p v-if="folderLoadError" class="error">{{ folderLoadError }}</p>
    </section>

    <ImageProcessingPanel
      v-model="imageProcessing"
      :active-format="activeImageFormat"
      :format-options="imageProcessingFormatOptions"
      :summary="imageProcessingSummary"
      @select-format="selectImageFormat"
    />

    <section class="image-upload-behavior card-lite">
      <div>
        <h3>{{ t('uv.imgBehavior') }}</h3>
        <p class="muted">{{ imageUploadDecisionSummary }}</p>
      </div>
      <div class="format-segments">
        <button
          v-for="option in imageUploadDecisionOptions"
          :key="option.value"
          class="chip"
          :class="{ active: imageUploadDecision === option.value }"
          type="button"
          @click="setImageUploadDecision(option.value)"
        >
          {{ option.label }}
        </button>
      </div>
    </section>

    <form class="url-row" @submit.prevent="uploadUrl">
      <input v-model.trim="urlInput" placeholder="https://example.com/file.png" />
      <button class="btn" :disabled="urlUploading || !urlInput">
        {{ urlUploading ? t('uv.uploading') : t('uv.uploadUrl') }}
      </button>
    </form>

    <div v-if="queue.length" class="list-wrap">
      <h3>{{ t('uv.queue') }}</h3>
      <ul class="list">
        <li v-for="item in queue" :key="item.id" class="list-item">
          <div class="list-title">
            <strong>{{ item.file.name }}</strong>
            <span>{{ formatSize(item.file.size) }}</span>
          </div>
          <p class="muted queue-target">{{ item.storageLabel }} · {{ formatFolderPath(item.targetFolderPath) }}</p>
          <p v-if="item.optimizationNote" class="muted queue-target">{{ item.optimizationNote }}</p>
          <div class="progress-track">
            <span class="progress-fill" :style="{ width: `${item.progress}%` }"></span>
          </div>
          <div class="list-meta">
            <span>{{ statusLabel(item.status) }}</span>
            <span v-if="item.error" class="error">{{ item.error }}</span>
          </div>
        </li>
      </ul>
    </div>

    <div v-if="results.length" class="list-wrap">
      <h3>{{ t('uv.uploaded') }}</h3>
      <ul class="list">
        <li v-for="item in results" :key="item.id" class="result-item">
          <div>
            <strong>{{ item.fileName }}</strong>
            <p class="muted">{{ item.link }}</p>
          </div>
          <div class="result-actions">
            <button class="btn btn-ghost" @click="copy(item.link)">{{ t('uv.copy') }}</button>
            <a class="btn btn-ghost" :href="item.link" target="_blank" rel="noopener">{{ t('uv.open') }}</a>
          </div>
        </li>
      </ul>
    </div>

    <p v-if="error" class="error">{{ error }}</p>
  </section>

  <UploadPreparationDialog
    v-if="pendingUploadBatch"
    v-model:image-processing="imageProcessing"
    :active-format="activeImageFormat"
    :batch="pendingUploadBatch"
    :format-options="imageProcessingFormatOptions"
    :format-size="formatSize"
    :summary="imageProcessingSummary"
    @cancel="cancelPendingUpload"
    @select-format="selectImageFormat"
    @upload-original="uploadPendingOriginal"
    @upload-optimized="uploadPendingOptimized"
  />
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { apiFetch, getApiBase } from '../api/client';
import { getDriveTree } from '../api/drive';
import ImageProcessingPanel from '../components/ImageProcessingPanel.vue';
import UploadPreparationDialog from '../components/UploadPreparationDialog.vue';
import { useImageProcessing } from '../composables/useImageProcessing';
import { STORAGE_TYPES, getStorageLabel, getUploadLimit, storageEnabledFromStatus } from '../config/storage-definitions';
import { isImageProcessable } from '../utils/image-processing';
import { createMultipartDigestPlan } from '../utils/multipart-digest';
import { useI18n } from '../i18n';

const { t } = useI18n();
const picker = ref(null);
const dragActive = ref(false);
const queue = ref([]);
const results = ref([]);
const selectedStorage = ref('telegram');
const status = ref(null);
const uploading = ref(false);
const error = ref('');
const urlInput = ref('');
const urlUploading = ref(false);
const folderTree = ref([]);
const folderLoading = ref(false);
const folderLoadError = ref('');
const folderLoadNotice = ref('');
const targetFolderPath = ref('');
const pendingUploadBatch = ref(null);

const DEFAULT_CHUNK_SIZE = 5 * 1024 * 1024;
const V2_ACCEPT = 'application/vnd.seraph.v2+json, application/json;q=0.9, text/plain;q=0.5, */*;q=0.1';
let folderTreeRequestId = 0;

const {
  imageProcessing,
  activeImageFormat,
  imageProcessingFormatOptions,
  imageProcessingSummary,
  refreshImageProcessingSupport,
  selectImageFormat,
  getImageProcessingSnapshot,
  getImageProcessingSnapshotForDecision,
  imageUploadDecision,
  setImageUploadDecision,
  prepareQueuedImage,
} = useImageProcessing({ formatSize });

const imageUploadDecisionOptions = computed(() => [
  { value: 'original', label: t('uv.optOriginal') },
  { value: 'optimized', label: t('uv.optOptimized') },
  { value: 'ask', label: t('uv.optAsk') },
]);

const imageUploadDecisionSummary = computed(() => {
  if (imageUploadDecision.value === 'optimized') {
    return t('uv.decOptimized');
  }
  if (imageUploadDecision.value === 'ask') {
    return t('uv.decAsk');
  }
  return t('uv.decOriginal');
});

const modes = computed(() => {
  return STORAGE_TYPES.map((item) => {
    const detail = status.value?.[item.value] || {};
    const available = storageEnabledFromStatus(status.value, item.value);
    const configured = Boolean(detail.configured);
    return {
      value: item.value,
      label: item.label,
      available,
      hint: available
        ? t('uv.hintReady')
        : (configured ? (detail.message || t('uv.hintConfiguredUnavailable')) : t('uv.hintNotConfigured')),
    };
  });
});

const currentStorageLabel = computed(() => {
  const found = modes.value.find((x) => x.value === selectedStorage.value);
  return found ? found.label : getStorageLabel('telegram');
});

const targetFolderPathModel = computed({
  get: () => targetFolderPath.value,
  set: (value) => {
    targetFolderPath.value = normalizeFolderPath(value);
  },
});

const folderBrowserAvailable = computed(() => folderTree.value.some((node) => normalizeFolderPath(node.path) !== ''));

const folderOptions = computed(() => {
  const options = [{ value: '', label: t('uv.rootSlash') }];
  const seen = new Set(['']);

  const nodes = [...folderTree.value]
    .filter((node) => normalizeFolderPath(node.path))
    .sort((a, b) => {
      const pathA = normalizeFolderPath(a.path);
      const pathB = normalizeFolderPath(b.path);
      const depthA = pathA.split('/').length;
      const depthB = pathB.split('/').length;
      if (depthA !== depthB) return depthA - depthB;
      return pathA.localeCompare(pathB, 'en', { sensitivity: 'base' });
    });

  for (const node of nodes) {
    const path = normalizeFolderPath(node.path);
    if (!path || seen.has(path)) continue;
    seen.add(path);
    options.push({ value: path, label: `/${path}` });
  }

  if (targetFolderPath.value && !seen.has(targetFolderPath.value)) {
    options.splice(1, 0, {
      value: targetFolderPath.value,
      label: `/${targetFolderPath.value} ${t('uv.customSuffix')}`,
    });
  }

  return options;
});

const targetFolderExists = computed(() => {
  if (!targetFolderPath.value) return true;
  return folderTree.value.some((node) => normalizeFolderPath(node.path) === targetFolderPath.value);
});

const targetFolderBadge = computed(() => {
  if (!targetFolderPath.value) return t('uv.badgeRoot');
  return targetFolderExists.value ? t('uv.badgeExisting') : t('uv.badgeCustom');
});

const folderHint = computed(() => {
  if (folderLoading.value) return t('uv.hintRefreshing');
  if (folderLoadNotice.value) return folderLoadNotice.value;
  if (!targetFolderPath.value) return t('uv.hintEmptyPath');
  if (targetFolderExists.value) return t('uv.hintExists');
  return t('uv.hintNewPath');
});

onMounted(async () => {
  await refreshImageProcessingSupport();
  try {
    status.value = await apiFetch('/api/status');
    const first = modes.value.find((item) => item.available);
    if (first) selectedStorage.value = first.value;
  } catch (err) {
    error.value = err.message;
  } finally {
    await loadFolderTree();
  }
});

watch(selectedStorage, () => {
  void loadFolderTree();
});

function openPicker() {
  picker.value?.click();
}

function handleFilePick(event) {
  const files = Array.from(event.target.files || []);
  prepareFilesForUpload(files);
  event.target.value = '';
}

function handleDrop(event) {
  dragActive.value = false;
  const files = Array.from(event.dataTransfer?.files || []);
  prepareFilesForUpload(files);
}

function createUploadContext() {
  return {
    storageMode: selectedStorage.value,
    storageLabel: currentStorageLabel.value,
    targetFolderPath: targetFolderPath.value,
  };
}

function prepareFilesForUpload(files) {
  if (!files.length) return;
  const imageCount = files.filter((file) => isImageProcessable(file)).length;
  const context = createUploadContext();

  if (imageCount > 0 && imageUploadDecision.value === 'ask') {
    pendingUploadBatch.value = {
      files,
      imageCount,
      context,
    };
    return;
  }

  enqueueFiles(files, getImageProcessingSnapshotForDecision(imageCount > 0 ? imageUploadDecision.value : 'original'), context);
}

function cancelPendingUpload() {
  pendingUploadBatch.value = null;
}

function uploadPendingOriginal() {
  const batch = pendingUploadBatch.value;
  if (!batch) return;
  pendingUploadBatch.value = null;
  enqueueFiles(batch.files, { ...getImageProcessingSnapshot(), enabled: false }, batch.context);
}

function uploadPendingOptimized() {
  const batch = pendingUploadBatch.value;
  if (!batch) return;
  pendingUploadBatch.value = null;
  enqueueFiles(batch.files, { ...getImageProcessingSnapshot(), enabled: true }, batch.context);
}

function enqueueFiles(files, imageProcessingOptions = getImageProcessingSnapshot(), context = createUploadContext()) {
  for (const file of files) {
    queue.value.push({
      id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
      file,
      storageMode: context.storageMode,
      storageLabel: context.storageLabel,
      targetFolderPath: context.targetFolderPath,
      progress: 0,
      status: 'pending',
      error: '',
      imageProcessingOptions: { ...imageProcessingOptions },
      imageProcessingPrepared: false,
      optimizationNote: '',
    });
  }
  void processQueue();
}

async function processQueue() {
  if (uploading.value) return;
  uploading.value = true;
  error.value = '';

  try {
    for (const item of queue.value) {
      if (item.status !== 'pending') continue;
      const selected = modes.value.find((mode) => mode.value === item.storageMode);
      if (!selected?.available) {
        item.status = 'error';
        item.error = t('uv.errStorageUnavailable');
        continue;
      }
      item.error = '';

      try {
        await prepareQueuedImage(item);
        validateUploadSize(item);
        item.status = 'uploading';

        const link = shouldChunkUpload(item)
          ? await chunkUpload(item)
          : await directUpload(item);

        item.status = 'success';
        item.progress = 100;
        results.value.unshift({
          id: item.id,
          fileName: item.file.name,
          link,
        });
      } catch (err) {
        if (item.multipartUploadId) {
          try {
            await apiFetch('/api/chunked-upload/cancel', {
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ uploadId: item.multipartUploadId }),
            });
          } catch (cleanupError) {
            item.error = humanizeError(`${err.message}; cleanup: ${cleanupError.message}`);
            item.status = 'error';
            continue;
          }
          item.multipartUploadId = null;
        }
        item.status = 'error';
        item.error = humanizeError(err.message || t('uv.errUploadFailed'));
      }
    }
  } finally {
    uploading.value = false;
  }
}

function getItemUploadLimit(item) {
  return getUploadLimit(status.value, item.storageMode);
}

function validateUploadSize(item) {
  const limit = getItemUploadLimit(item);
  const maxBytes = Number(limit.maxBytes || 0);
  if (maxBytes > 0 && item.file.size > maxBytes) {
    throw new Error(limit.message || t('uv.errLimit', { label: item.storageLabel, size: formatSize(maxBytes) }));
  }

  const directThreshold = Number(limit.directThreshold || DEFAULT_CHUNK_SIZE);
  if (item.file.size > directThreshold && limit.supportsChunkUpload === false) {
    throw new Error(limit.message || t('uv.errNoChunk', { label: item.storageLabel, size: formatSize(directThreshold) }));
  }
}

function shouldChunkUpload(item) {
  const limit = getItemUploadLimit(item);
  const directThreshold = Number(limit.directThreshold || 20 * 1024 * 1024);
  return item.file.size > directThreshold && limit.supportsChunkUpload !== false;
}

function apiUrl(path) {
  return `${getApiBase()}${path}`;
}

function normalizeFolderPath(value) {
  const segments = [];
  const raw = String(value || '').replace(/\\/g, '/');
  for (const piece of raw.split('/')) {
    const part = piece.trim();
    if (!part || part === '.') continue;
    if (part === '..') {
      segments.pop();
      continue;
    }
    segments.push(part);
  }
  return segments.join('/');
}

function formatFolderPath(path) {
  const normalized = normalizeFolderPath(path);
  return normalized ? `/${normalized}` : t('uv.rootSlash');
}

function setTargetFolder(path) {
  targetFolderPath.value = normalizeFolderPath(path);
}

async function reloadFolderTree() {
  await loadFolderTree();
}

async function loadFolderTree() {
  const requestId = ++folderTreeRequestId;
  folderLoading.value = true;
  folderLoadError.value = '';
  folderLoadNotice.value = '';

  try {
    const nodes = await getDriveTree(selectedStorage.value);
    if (requestId !== folderTreeRequestId) return;

    folderTree.value = Array.isArray(nodes) ? nodes : [];
    if (folderTree.value.length <= 1) {
      folderLoadNotice.value = t('uv.noticeNoFolders');
    }
  } catch (err) {
    if (requestId !== folderTreeRequestId) return;

    folderTree.value = [];
    if (err?.status === 401 || err?.status === 403) {
      folderLoadNotice.value = t('uv.noticeBrowserUnavailable');
      return;
    }
    folderLoadError.value = err.message || t('uv.errLoadFolders');
  } finally {
    if (requestId === folderTreeRequestId) {
      folderLoading.value = false;
    }
  }
}

function toAbsoluteUrl(path) {
  return new URL(path, window.location.origin).toString();
}

function truncate(text, maxLength = 220) {
  const value = String(text || '');
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function parseJsonSafe(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function resolveUploadErrorMessage(payload, statusCode, rawText = '') {
  if (payload && typeof payload === 'object') {
    const nestedMessage = typeof payload?.error?.message === 'string' ? payload.error.message : '';
    const message = nestedMessage
      || payload?.error
      || payload?.message
      || payload?.errorDetail
      || payload?.detail;
    if (typeof message === 'string' && message.trim()) return message.trim();
  }

  if (rawText) {
    return `Backend returned non-JSON response (${statusCode}): ${truncate(rawText)}`;
  }
  return `Upload failed (${statusCode})`;
}

function humanizeError(message) {
  const text = String(message || '');
  const normalized = text.toLowerCase();

  if (normalized.includes('auth_failed') || normalized.includes('unauthorized') || normalized.includes('forbidden')) {
    return `${t('uv.errAuth')}: ${text}`;
  }
  if (normalized.includes('rate') || normalized.includes('too many requests') || normalized.includes('flood')) {
    return `${t('uv.errRate')}: ${text}`;
  }
  if (normalized.includes('quota') || normalized.includes('limit exceeded') || normalized.includes('too large') || normalized.includes('413')) {
    return `${t('uv.errQuota')}: ${text}`;
  }
  if (normalized.includes('network') || normalized.includes('timeout') || normalized.includes('fetch failed')) {
    return `${t('uv.errNetwork')}: ${text}`;
  }
  if (normalized.includes('not configured')) {
    return `${t('uv.errNotConfigured')}: ${text}`;
  }
  return text || t('uv.errUploadFailed');
}

function directUpload(item) {
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    formData.append('file', item.file);
    formData.append('storageMode', item.storageMode);
    formData.append('folderPath', item.targetFolderPath || '');

    const xhr = new XMLHttpRequest();
    xhr.open('POST', apiUrl('/upload'));
    xhr.withCredentials = true;
    xhr.setRequestHeader('Accept', V2_ACCEPT);
    xhr.setRequestHeader('X-Seraph-Client', 'app-v2');

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      item.progress = Math.max(1, Math.floor((event.loaded / event.total) * 100));
    };

    xhr.onload = () => {
      const rawText = String(xhr.responseText || '');
      const body = parseJsonSafe(rawText);

      if (xhr.status < 200 || xhr.status >= 300) {
        const message = resolveUploadErrorMessage(body, xhr.status, rawText);
        reject(new Error(humanizeError(message)));
        return;
      }

      const src = Array.isArray(body)
        ? body[0]?.src
        : (body?.src || body?.data?.src || body?.data?.items?.[0]?.src || body?.items?.[0]?.src);

      if (!src) {
        if (!body) {
          reject(new Error(`Backend returned non-JSON response: ${truncate(rawText) || '<empty body>'}`));
          return;
        }
        reject(new Error(t('uv.errMissingSrc')));
        return;
      }
      resolve(toAbsoluteUrl(src));
    };

    xhr.onerror = () => reject(new Error(t('uv.errNetworkShort')));
    xhr.send(formData);
  });
}

async function chunkUpload(item) {
  const totalChunks = Math.ceil(item.file.size / DEFAULT_CHUNK_SIZE);
  const digests = await createMultipartDigestPlan(item.file, DEFAULT_CHUNK_SIZE);

  const init = await apiFetch('/api/chunked-upload/init', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: V2_ACCEPT,
      'X-Seraph-Client': 'app-v2',
    },
    body: JSON.stringify({
      fileName: item.file.name,
      fileSize: item.file.size,
      fileType: item.file.type,
      totalChunks,
      rootDigest: digests.rootDigest,
      storageMode: item.storageMode,
      folderPath: item.targetFolderPath || '',
    }),
  });

  const uploadId = init.uploadId;
  item.multipartUploadId = uploadId;
  const chunkSize = Number(init.chunkSize || DEFAULT_CHUNK_SIZE);

  for (let index = 0; index < totalChunks; index += 1) {
    const start = index * chunkSize;
    const end = Math.min(item.file.size, start + chunkSize);
    const chunk = item.file.slice(start, end);

    const chunkBody = new FormData();
    chunkBody.append('uploadId', uploadId);
    chunkBody.append('chunkIndex', String(index));
    chunkBody.append('digest', digests.partDigests[index]);
    chunkBody.append('chunk', chunk);

    await apiFetch('/api/chunked-upload/chunk', {
      method: 'POST',
      headers: {
        Accept: V2_ACCEPT,
        'X-Seraph-Client': 'app-v2',
      },
      body: chunkBody,
    });

    item.progress = Math.min(95, Math.floor(((index + 1) / totalChunks) * 95));
  }

  const done = await apiFetch('/api/chunked-upload/complete', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: V2_ACCEPT,
      'X-Seraph-Client': 'app-v2',
    },
    body: JSON.stringify({ uploadId }),
  });

  if (!done?.src) {
    throw new Error(t('uv.errMissingSrc'));
  }

  item.multipartUploadId = null;
  return toAbsoluteUrl(done.src);
}

async function uploadUrl() {
  if (!urlInput.value || urlUploading.value) return;
  const selected = modes.value.find((mode) => mode.value === selectedStorage.value);
  if (!selected?.available) {
    error.value = t('uv.errStorageUnavailable');
    return;
  }

  urlUploading.value = true;
  error.value = '';

  try {
    const body = await apiFetch('/api/upload-from-url', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: V2_ACCEPT,
        'X-Seraph-Client': 'app-v2',
      },
      body: JSON.stringify({
        url: urlInput.value,
        storageMode: selectedStorage.value,
        folderPath: targetFolderPath.value,
      }),
    });

    const src = Array.isArray(body) ? body[0]?.src : body?.src;
    if (!src) {
      throw new Error(t('uv.errMissingSrc'));
    }

    results.value.unshift({
      id: `url_${Date.now()}`,
      fileName: urlInput.value.split('/').pop() || 'remote-file',
      link: toAbsoluteUrl(src),
    });

    urlInput.value = '';
  } catch (err) {
    error.value = humanizeError(err.message || t('uv.errUrlUploadFailed'));
  } finally {
    urlUploading.value = false;
  }
}

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

function statusLabel(status) {
  const map = {
    pending: t('uv.stPending'),
    uploading: t('uv.stUploading'),
    success: t('uv.stSuccess'),
    error: t('uv.stError'),
  };
  return map[status] || status;
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const input = document.createElement('textarea');
    input.value = text;
    document.body.appendChild(input);
    input.select();
    document.execCommand('copy');
    document.body.removeChild(input);
  }
}
</script>
