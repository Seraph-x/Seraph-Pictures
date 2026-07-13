<template>
  <section class="card panel drive-panel">
    <header class="drive-header">
      <div>
        <h2>{{ t('dv.title') }}</h2>
        <p class="muted">{{ t('dv.subtitle') }}</p>
      </div>
      <div class="drive-head-actions">
        <button class="btn btn-ghost" @click="refreshAll">{{ t('dv.refresh') }}</button>
      </div>
    </header>

    <section class="adapter-visibility card-lite">
      <div class="adapter-visibility-head">
        <h3>{{ t('dv.capVisibility') }}</h3>
        <p class="muted">{{ t('dv.capVisibilityNote') }}</p>
      </div>
      <div class="adapter-grid">
        <article
          v-for="cap in capabilityCards"
          :key="cap.type"
          class="adapter-card"
          :class="{ active: selectedStorage === cap.type, unavailable: !cap.available }"
          @click="selectStorage(cap)"
        >
          <div class="adapter-card-top">
            <strong>{{ cap.label }}</strong>
            <span class="badge">{{ cap.layerLabel }}</span>
          </div>
          <p class="muted">{{ cap.description }}</p>
          <p class="adapter-status" :class="cap.available ? 'ok' : (cap.configured ? 'warn' : 'fail')">
            {{ cap.statusText }}
          </p>
          <p class="adapter-hint">{{ cap.hint }}</p>
        </article>
      </div>
    </section>

    <section
      class="drive-dropzone"
      :class="{ active: dragActive }"
      @dragover.prevent="dragActive = true"
      @dragleave.prevent="dragActive = false"
      @drop.prevent="handleDrop"
      @click="openPicker"
    >
      <input ref="picker" type="file" multiple hidden @change="handleFilePick" />
      <p class="dropzone-title">{{ t('dv.dropTitle') }}</p>
      <p class="muted">{{ t('dv.currentStorage') }} {{ currentStorageLabel }} | {{ t('dv.folder') }} /{{ currentPath || '' }}</p>
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
        <h3>{{ t('dv.imgBehavior') }}</h3>
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
      <input v-model.trim="urlInput" placeholder="https://example.com/file.zip" />
      <button class="btn" :disabled="urlUploading || !urlInput">
        {{ urlUploading ? t('dv.uploading') : t('dv.uploadUrlBtn') }}
      </button>
    </form>

    <div v-if="queue.length" class="list-wrap">
      <h3>{{ t('dv.uploadQueue') }}</h3>
      <ul class="list">
        <li v-for="item in queue" :key="item.id" class="list-item">
          <div class="list-title">
            <strong>{{ item.file.name }}</strong>
            <span>{{ formatSize(item.file.size) }}</span>
          </div>
          <p class="muted" v-if="item.relativePath">{{ t('dv.relativePath') }} {{ item.relativePath }}</p>
          <p class="muted">{{ t('dv.targetFolder') }} /{{ item.targetFolderPath || '' }}</p>
          <p v-if="item.optimizationNote" class="muted">{{ item.optimizationNote }}</p>
          <div class="progress-track">
            <span class="progress-fill" :style="{ width: `${item.progress}%` }"></span>
          </div>
          <div class="list-meta">
            <span>{{ statusLabel(item.status) }}</span>
            <span v-if="item.error" class="error">{{ item.error }}</span>
          </div>
          <div class="result-actions">
            <button class="btn btn-ghost" v-if="item.status === 'error'" @click="retryUpload(item.id)">{{ t('dv.retry') }}</button>
            <button class="btn btn-ghost" v-if="item.status === 'uploading'" @click="cancelUpload(item.id)">{{ t('dv.cancel') }}</button>
          </div>
        </li>
      </ul>
    </div>

    <div class="drive-layout">
      <aside class="folder-tree card-lite">
        <div class="folder-tree-head">
          <h3>{{ t('dv.folders') }}</h3>
          <button class="btn btn-ghost" @click="promptCreateFolder">{{ t('dv.new') }}</button>
        </div>
        <ul class="tree-list">
          <li
            v-for="node in flatTreeNodes"
            :key="node.path || '__root__'"
            class="tree-item"
            :class="{ active: currentPath === node.path }"
            :style="{ paddingLeft: `${12 + node.depth * 14}px` }"
          >
            <button class="tree-link" @click="openPath(node.path)">
              <span>{{ node.name }}</span>
              <small>{{ node.fileCount }}</small>
            </button>
          </li>
        </ul>
      </aside>

      <article class="drive-main card-lite">
        <div class="drive-toolbar">
          <div class="breadcrumbs">
            <button
              v-for="crumb in breadcrumbs"
              :key="crumb.path || '__root__'"
              class="crumb"
              @click="openPath(crumb.path)"
            >
              {{ crumb.name }}
            </button>
          </div>
          <div class="toolbar">
            <input v-model.trim="search" :placeholder="t('dv.searchPh')" @keyup.enter="reloadExplorer" />
            <select v-model="storageFilter" @change="refreshAll">
              <option value="all">{{ t('dv.allStorage') }}</option>
              <option v-for="type in STORAGE_TYPES" :key="type.value" :value="type.value">{{ type.label }}</option>
            </select>
            <select v-model="viewMode">
              <option value="list">{{ t('dv.viewList') }}</option>
              <option value="grid">{{ t('dv.viewGrid') }}</option>
            </select>
            <button class="btn btn-ghost" @click="promptMoveSelected" :disabled="selectedFileIds.length === 0">{{ t('dv.move') }}</button>
            <button class="btn btn-danger" @click="deleteSelected" :disabled="selectedFileIds.length === 0">{{ t('dv.delete') }}</button>
          </div>
        </div>

        <div class="folder-inline-list" v-if="folders.length">
          <article v-for="folder in folders" :key="folder.path" class="folder-card">
            <button class="folder-open" @dblclick="openPath(folder.path)" @click="openPath(folder.path)">
              <strong>{{ folder.name }}</strong>
              <small>{{ folder.fileCount }} {{ t('dv.files') }}</small>
            </button>
            <div class="folder-card-actions">
              <button class="btn btn-ghost" @click="promptRenameFolder(folder)">{{ t('dv.rename') }}</button>
              <button class="btn btn-ghost" @click="promptMoveFolder(folder)">{{ t('dv.move') }}</button>
              <button class="btn btn-danger" @click="deleteFolderAction(folder)">{{ t('dv.delete') }}</button>
            </div>
          </article>
        </div>

        <div v-if="viewMode === 'grid'" class="file-grid">
          <article v-for="file in files" :key="file.name" class="file-card">
            <label class="file-check">
              <input type="checkbox" :checked="selectedSet.has(file.name)" @change="toggleFileSelection(file.name)" />
            </label>
            <a :href="fileLink(file.name)" target="_blank" rel="noopener" class="file-preview">
              <img v-if="isImage(file.metadata?.fileName || file.name)" :src="fileLink(file.name)" :alt="file.metadata?.fileName || file.name" />
              <span v-else>{{ t('dv.filePlaceholder') }}</span>
            </a>
            <strong class="file-name">{{ file.metadata?.fileName || file.name }}</strong>
            <small class="muted">{{ formatSize(file.metadata?.fileSize || 0) }}</small>
            <div class="file-actions">
              <button class="btn btn-ghost" @click="copyDirect(file)">{{ t('dv.direct') }}</button>
              <button class="btn btn-ghost" @click="copyShare(file)">{{ t('dv.share') }}</button>
              <button class="btn btn-ghost" @click="promptRenameFile(file)">{{ t('dv.rename') }}</button>
              <button class="btn btn-ghost" @click="promptMoveFile(file)">{{ t('dv.move') }}</button>
              <button class="btn btn-danger" @click="deleteFile(file)">{{ t('dv.delete') }}</button>
            </div>
          </article>
        </div>

        <div v-else class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th><input type="checkbox" :checked="allSelected" @change="toggleSelectAll" /></th>
                <th>{{ t('dv.colName') }}</th>
                <th>{{ t('dv.colStorage') }}</th>
                <th>{{ t('dv.colSize') }}</th>
                <th>{{ t('dv.colUpdated') }}</th>
                <th>{{ t('dv.colActions') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="file in files" :key="file.name">
                <td><input type="checkbox" :checked="selectedSet.has(file.name)" @change="toggleFileSelection(file.name)" /></td>
                <td>
                  <div class="file-col">
                    <strong>{{ file.metadata?.fileName || file.name }}</strong>
                    <small>{{ file.name }}</small>
                  </div>
                </td>
                <td><span class="badge">{{ file.metadata?.storageType || t('dv.unknown') }}</span></td>
                <td>{{ formatSize(file.metadata?.fileSize || 0) }}</td>
                <td>{{ formatTime(file.metadata?.TimeStamp) }}</td>
                <td>
                  <div class="table-actions">
                    <button class="btn btn-ghost" @click="copyDirect(file)">{{ t('dv.direct') }}</button>
                    <button class="btn btn-ghost" @click="copyShare(file)">{{ t('dv.share') }}</button>
                    <button class="btn btn-ghost" @click="promptRenameFile(file)">{{ t('dv.rename') }}</button>
                    <button class="btn btn-ghost" @click="promptMoveFile(file)">{{ t('dv.move') }}</button>
                    <button class="btn btn-danger" @click="deleteFile(file)">{{ t('dv.delete') }}</button>
                  </div>
                </td>
              </tr>
              <tr v-if="!loading && files.length === 0">
                <td colspan="6" class="empty">{{ t('dv.emptyFolder') }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="footer-actions">
          <button v-if="nextCursor" class="btn" :disabled="loading" @click="loadMore">
            {{ loading ? t('dv.loading') : t('dv.loadMore') }}
          </button>
        </div>
      </article>
    </div>

    <p v-if="message" class="muted">{{ message }}</p>
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
import { computed, onMounted, ref } from 'vue';
import { apiFetch, absoluteFileUrl, getApiBase } from '../api/client';
import {
  createFolder,
  deleteFiles,
  deleteFolder,
  getDriveExplorer,
  getDriveTree,
  moveFiles,
  moveFolder,
  renameFile,
  signShareLink,
} from '../api/drive';
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
const uploading = ref(false);
const urlInput = ref('');
const urlUploading = ref(false);
const status = ref(null);
const selectedStorage = ref('telegram');

const treeNodes = ref([]);
const folders = ref([]);
const files = ref([]);
const breadcrumbs = ref([{ path: '', name: t('dv.allFiles') }]);
const currentPath = ref('');
const storageFilter = ref('all');
const search = ref('');
const nextCursor = ref(null);
const loading = ref(false);
const viewMode = ref('list');
const selectedFileIds = ref([]);
const message = ref('');
const error = ref('');
const pendingUploadBatch = ref(null);

const DEFAULT_CHUNK_SIZE = 5 * 1024 * 1024;
const V2_ACCEPT = 'application/vnd.seraph.v2+json, application/json;q=0.9, text/plain;q=0.5, */*;q=0.1';

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
  { value: 'original', label: t('dv.optOriginal') },
  { value: 'optimized', label: t('dv.optOptimized') },
  { value: 'ask', label: t('dv.optAsk') },
]);

const imageUploadDecisionSummary = computed(() => {
  if (imageUploadDecision.value === 'optimized') {
    return t('dv.decOptimized');
  }
  if (imageUploadDecision.value === 'ask') {
    return t('dv.decAsk');
  }
  return t('dv.decOriginal');
});

const selectedSet = computed(() => new Set(selectedFileIds.value));
const allSelected = computed(() => files.value.length > 0 && selectedFileIds.value.length === files.value.length);

const capabilityCards = computed(() => {
  const capabilityList = Array.isArray(status.value?.capabilities)
    ? status.value.capabilities
    : STORAGE_TYPES.map((item) => ({
      type: item.value,
      label: item.label,
      layer: item.layer || 'direct',
      enableHint: t('dv.configureAdapter'),
    }));

  return capabilityList.map((cap) => {
    const detail = status.value?.[cap.type] || {};
    const configured = Boolean(detail.configured);
    const available = storageEnabledFromStatus(status.value, cap.type);
    const layerLabel = cap.layer === 'mounted' ? t('dv.layerMounted') : t('dv.layerDirect');
    let statusText = t('dv.stNotConfigured');
    if (available) statusText = t('dv.stAvailable');
    else if (configured) statusText = detail.message || t('dv.stConfiguredUnavailable');
    return {
      ...cap,
      description: STORAGE_TYPES.find((x) => x.value === cap.type)?.description || '',
      configured,
      available,
      layerLabel,
      statusText,
      hint: available ? t('dv.hintReady') : (detail.message || cap.enableHint || t('dv.hintConfigureToEnable')),
    };
  });
});

const availableModes = computed(() => capabilityCards.value.filter((item) => item.available));

const currentStorageLabel = computed(() => {
  const found = capabilityCards.value.find((item) => item.type === selectedStorage.value);
  return found?.label || 'Telegram';
});

const flatTreeNodes = computed(() => {
  const sorted = [...treeNodes.value].sort((a, b) => {
    const depthA = a.path ? a.path.split('/').length : 0;
    const depthB = b.path ? b.path.split('/').length : 0;
    if (depthA !== depthB) return depthA - depthB;
    return String(a.path || '').localeCompare(String(b.path || ''), 'en', { sensitivity: 'base' });
  });
  return sorted.map((node) => ({
    ...node,
    depth: node.path ? node.path.split('/').length : 0,
  }));
});

onMounted(async () => {
  await refreshImageProcessingSupport();
  await refreshStatus();
  await refreshAll();
});

function selectStorage(capability) {
  if (!capability.available) return;
  selectedStorage.value = capability.type;
}

async function refreshStatus() {
  try {
    status.value = await apiFetch('/api/status');
    if (!availableModes.value.some((item) => item.type === selectedStorage.value)) {
      selectedStorage.value = availableModes.value[0]?.type || 'telegram';
    }
  } catch (err) {
    error.value = err.message || t('dv.errLoadStatus');
  }
}

async function refreshAll() {
  await Promise.all([loadTree(), reloadExplorer()]);
}

async function loadTree() {
  try {
    treeNodes.value = await getDriveTree(storageFilter.value);
  } catch (err) {
    error.value = err.message || t('dv.errLoadTree');
  }
}

async function reloadExplorer() {
  nextCursor.value = null;
  await loadExplorer(true);
}

async function loadMore() {
  await loadExplorer(false);
}

async function loadExplorer(reset) {
  if (loading.value) return;
  loading.value = true;
  error.value = '';

  try {
    const data = await getDriveExplorer({
      path: currentPath.value,
      storage: storageFilter.value,
      search: search.value,
      limit: 100,
      cursor: reset ? '' : (nextCursor.value || ''),
      includeStats: reset,
    });

    folders.value = Array.isArray(data.folders) ? data.folders : [];
    breadcrumbs.value = Array.isArray(data.breadcrumbs) ? data.breadcrumbs : [{ path: '', name: t('dv.allFiles') }];

    const incomingFiles = Array.isArray(data.files) ? data.files : [];
    if (reset) {
      files.value = incomingFiles;
      selectedFileIds.value = [];
    } else {
      const seen = new Set(files.value.map((item) => item.name));
      for (const item of incomingFiles) {
        if (!seen.has(item.name)) files.value.push(item);
      }
    }

    nextCursor.value = data.list_complete ? null : data.cursor;
  } catch (err) {
    error.value = err.message || t('dv.errLoadExplorer');
  } finally {
    loading.value = false;
  }
}

function openPath(path) {
  currentPath.value = path || '';
  void reloadExplorer();
}

function openPicker() {
  picker.value?.click();
}

function handleFilePick(event) {
  const filesPicked = Array.from(event.target.files || []);
  prepareItemsForUpload(filesPicked.map((file) => ({ file, relativePath: '' })));
  event.target.value = '';
}

async function handleDrop(event) {
  dragActive.value = false;
  const dropped = await extractDroppedFiles(event.dataTransfer);
  prepareItemsForUpload(dropped);
}

async function extractDroppedFiles(dataTransfer) {
  const output = [];
  if (!dataTransfer?.items?.length) {
    return Array.from(dataTransfer?.files || []).map((file) => ({ file, relativePath: '' }));
  }

  const tasks = [];
  for (const item of Array.from(dataTransfer.items)) {
    const entry = item.webkitGetAsEntry?.();
    if (!entry) {
      const file = item.getAsFile?.();
      if (file) output.push({ file, relativePath: '' });
      continue;
    }
    tasks.push(readEntry(entry, ''));
  }

  const nested = await Promise.all(tasks);
  for (const list of nested) {
    output.push(...list);
  }
  return output;
}

function readEntry(entry, parentPath) {
  return new Promise((resolve) => {
    if (entry.isFile) {
      entry.file((file) => {
        resolve([{ file, relativePath: parentPath ? `${parentPath}/${file.name}` : file.name }]);
      });
      return;
    }

    if (!entry.isDirectory) {
      resolve([]);
      return;
    }

    const reader = entry.createReader();
    const entries = [];

    function readBatch() {
      reader.readEntries(async (batch) => {
        if (!batch.length) {
          const children = await Promise.all(entries.map((child) => readEntry(child, parentPath ? `${parentPath}/${entry.name}` : entry.name)));
          resolve(children.flat());
          return;
        }
        entries.push(...batch);
        readBatch();
      });
    }

    readBatch();
  });
}

function joinPath(base, extra) {
  const segments = [];
  for (const piece of [base, extra]) {
    const normalized = String(piece || '').replace(/\\/g, '/');
    for (const part of normalized.split('/')) {
      const cleaned = part.trim();
      if (!cleaned || cleaned === '.') continue;
      if (cleaned === '..') {
        segments.pop();
      } else {
        segments.push(cleaned);
      }
    }
  }
  return segments.join('/');
}

function createUploadContext() {
  return {
    storageMode: selectedStorage.value,
    storageLabel: currentStorageLabel.value,
    currentPath: currentPath.value,
  };
}

function prepareItemsForUpload(list) {
  if (!list.length) return;
  const imageCount = list.filter((item) => isImageProcessable(item.file)).length;
  const context = createUploadContext();

  if (imageCount > 0 && imageUploadDecision.value === 'ask') {
    pendingUploadBatch.value = {
      items: list,
      imageCount,
      context,
    };
    return;
  }

  enqueueFiles(list, getImageProcessingSnapshotForDecision(imageCount > 0 ? imageUploadDecision.value : 'original'), context);
}

function cancelPendingUpload() {
  pendingUploadBatch.value = null;
}

function uploadPendingOriginal() {
  const batch = pendingUploadBatch.value;
  if (!batch) return;
  pendingUploadBatch.value = null;
  enqueueFiles(batch.items, { ...getImageProcessingSnapshot(), enabled: false }, batch.context);
}

function uploadPendingOptimized() {
  const batch = pendingUploadBatch.value;
  if (!batch) return;
  pendingUploadBatch.value = null;
  enqueueFiles(batch.items, { ...getImageProcessingSnapshot(), enabled: true }, batch.context);
}

function enqueueFiles(list, imageProcessingOptions = getImageProcessingSnapshot(), context = createUploadContext()) {
  for (const item of list) {
    const file = item.file;
    const relativePath = item.relativePath || '';
    const parentPath = relativePath.includes('/')
      ? relativePath.split('/').slice(0, -1).join('/')
      : '';
    const targetFolderPath = joinPath(context.currentPath, parentPath);

    queue.value.push({
      id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
      file,
      relativePath,
      targetFolderPath,
      storageMode: context.storageMode,
      storageLabel: context.storageLabel,
      progress: 0,
      status: 'pending',
      error: '',
      cancelled: false,
      xhr: null,
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
  let shouldReload = false;

  try {
    for (const item of queue.value) {
      if (item.status !== 'pending') continue;
      if (!availableModes.value.some((mode) => mode.type === item.storageMode)) {
        item.status = 'error';
        item.error = t('dv.errStorageUnavailable');
        continue;
      }

      item.error = '';
      item.cancelled = false;

      try {
        await prepareQueuedImage(item);
        validateUploadSize(item);
        item.status = 'uploading';

        if (shouldChunkUpload(item)) {
          await chunkUpload(item);
        } else {
          await directUpload(item);
        }
        item.status = 'success';
        item.progress = 100;
        shouldReload = true;
      } catch (err) {
        if (item.multipartUploadId) {
          try {
            await apiFetch('/api/chunked-upload/cancel', {
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ uploadId: item.multipartUploadId }),
            });
          } catch (cleanupError) {
            item.status = 'error';
            item.error = humanizeError(`${err.message}; cleanup: ${cleanupError.message}`);
            continue;
          }
          item.multipartUploadId = null;
        }
        if (item.cancelled) {
          item.status = 'cancelled';
          item.error = '';
        } else {
          item.status = 'error';
          item.error = humanizeError(err.message || t('dv.errUploadFailed'));
        }
      }
    }
  } finally {
    uploading.value = false;
    if (shouldReload) {
      await refreshAll();
    }
  }
}

function getItemUploadLimit(item) {
  return getUploadLimit(status.value, item.storageMode);
}

function validateUploadSize(item) {
  const limit = getItemUploadLimit(item);
  const maxBytes = Number(limit.maxBytes || 0);
  if (maxBytes > 0 && item.file.size > maxBytes) {
    throw new Error(limit.message || t('dv.errLimit', { label: item.storageLabel, size: formatSize(maxBytes) }));
  }

  const directThreshold = Number(limit.directThreshold || DEFAULT_CHUNK_SIZE);
  if (item.file.size > directThreshold && limit.supportsChunkUpload === false) {
    throw new Error(limit.message || t('dv.errNoChunk', { label: item.storageLabel, size: formatSize(directThreshold) }));
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

function humanizeError(message) {
  const text = String(message || '');
  const normalized = text.toLowerCase();

  if (normalized.includes('auth_failed') || normalized.includes('unauthorized') || normalized.includes('forbidden')) {
    return `${t('dv.errAuth')}: ${text}`;
  }
  if (normalized.includes('rate') || normalized.includes('too many requests') || normalized.includes('flood')) {
    return `${t('dv.errRate')}: ${text}`;
  }
  if (normalized.includes('quota') || normalized.includes('limit exceeded') || normalized.includes('too large') || normalized.includes('413')) {
    return `${t('dv.errQuota')}: ${text}`;
  }
  if (normalized.includes('network') || normalized.includes('timeout') || normalized.includes('fetch failed')) {
    return `${t('dv.errNetwork')}: ${text}`;
  }
  if (normalized.includes('not configured')) {
    return `${t('dv.errNotConfigured')}: ${text}`;
  }
  return text || t('dv.errUploadFailed');
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
    return t('dv.errNonJson', { code: statusCode, text: truncate(rawText) });
  }
  return t('dv.errUploadFailedCode', { code: statusCode });
}

function directUpload(item) {
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    formData.append('file', item.file);
    formData.append('storageMode', item.storageMode);
    formData.append('folderPath', item.targetFolderPath || '');

    const xhr = new XMLHttpRequest();
    item.xhr = xhr;
    xhr.open('POST', apiUrl('/upload'));
    xhr.withCredentials = true;
    xhr.setRequestHeader('Accept', V2_ACCEPT);
    xhr.setRequestHeader('X-Seraph-Client', 'app-v2');

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      item.progress = Math.max(1, Math.floor((event.loaded / event.total) * 100));
    };

    xhr.onload = () => {
      item.xhr = null;
      const rawText = String(xhr.responseText || '');
      const body = parseJsonSafe(rawText);
      if (xhr.status < 200 || xhr.status >= 300) {
        const message = resolveUploadErrorMessage(body, xhr.status, rawText);
        reject(new Error(humanizeError(message)));
        return;
      }
      if (!body) {
        reject(new Error(t('dv.errNonJsonEmpty', { text: truncate(rawText) || t('dv.emptyBody') })));
        return;
      }
      resolve(body);
    };

    xhr.onerror = () => {
      item.xhr = null;
      reject(new Error(t('dv.errNetworkShort')));
    };

    xhr.onabort = () => {
      item.xhr = null;
      item.cancelled = true;
      reject(new Error(t('dv.errCancelled')));
    };

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
    if (item.cancelled) throw new Error(t('dv.errCancelled'));

    const start = index * chunkSize;
    const end = Math.min(item.file.size, start + chunkSize);
    const chunk = item.file.slice(start, end);

    const body = new FormData();
    body.append('uploadId', uploadId);
    body.append('chunkIndex', String(index));
    body.append('digest', digests.partDigests[index]);
    body.append('chunk', chunk);

    await apiFetch('/api/chunked-upload/chunk', {
      method: 'POST',
      headers: {
        Accept: V2_ACCEPT,
        'X-Seraph-Client': 'app-v2',
      },
      body,
    });

    item.progress = Math.min(95, Math.floor(((index + 1) / totalChunks) * 95));
  }

  await apiFetch('/api/chunked-upload/complete', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: V2_ACCEPT,
      'X-Seraph-Client': 'app-v2',
    },
    body: JSON.stringify({ uploadId }),
  });
  item.multipartUploadId = null;
}

async function cancelUpload(id) {
  const target = queue.value.find((item) => item.id === id);
  if (!target) return;
  target.cancelled = true;
  if (target.multipartUploadId) {
    await apiFetch('/api/chunked-upload/cancel', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uploadId: target.multipartUploadId }),
    });
    target.multipartUploadId = null;
  }
  if (target.xhr) {
    target.xhr.abort();
    return;
  }
  if (target.status === 'pending') {
    target.status = 'cancelled';
  }
}

function retryUpload(id) {
  const target = queue.value.find((item) => item.id === id);
  if (!target) return;
  target.status = 'pending';
  target.progress = 0;
  target.error = '';
  target.cancelled = false;
  void processQueue();
}

async function uploadUrl() {
  if (!urlInput.value || urlUploading.value) return;
  urlUploading.value = true;
  error.value = '';

  try {
    await apiFetch('/api/upload-from-url', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: V2_ACCEPT,
        'X-Seraph-Client': 'app-v2',
      },
      body: JSON.stringify({
        url: urlInput.value,
        storageMode: selectedStorage.value,
        folderPath: currentPath.value,
      }),
    });
    urlInput.value = '';
    await refreshAll();
  } catch (err) {
    error.value = humanizeError(err.message || t('dv.errUrlUploadFailed'));
  } finally {
    urlUploading.value = false;
  }
}

function toggleFileSelection(id) {
  if (selectedSet.value.has(id)) {
    selectedFileIds.value = selectedFileIds.value.filter((item) => item !== id);
  } else {
    selectedFileIds.value = [...selectedFileIds.value, id];
  }
}

function toggleSelectAll() {
  if (allSelected.value) {
    selectedFileIds.value = [];
  } else {
    selectedFileIds.value = files.value.map((file) => file.name);
  }
}

async function promptCreateFolder() {
  const name = window.prompt(t('dv.promptFolderName'));
  if (!name) return;
  const path = joinPath(currentPath.value, name);
  try {
    await createFolder(path);
    await refreshAll();
  } catch (err) {
    error.value = err.message || t('dv.errCreateFolder');
  }
}

async function promptRenameFolder(folder) {
  const nextName = window.prompt(t('dv.promptRenameFolder'), folder.name);
  if (!nextName || nextName === folder.name) return;
  const parent = folder.parentPath || '';
  const targetPath = joinPath(parent, nextName);
  try {
    await moveFolder(folder.path, targetPath);
    if (currentPath.value.startsWith(`${folder.path}/`) || currentPath.value === folder.path) {
      currentPath.value = currentPath.value.replace(folder.path, targetPath);
    }
    await refreshAll();
  } catch (err) {
    error.value = err.message || t('dv.errRenameFolder');
  }
}

async function promptMoveFolder(folder) {
  const target = window.prompt(t('dv.promptMoveFolder'), folder.path);
  if (!target || target === folder.path) return;
  try {
    await moveFolder(folder.path, target);
    if (currentPath.value.startsWith(`${folder.path}/`) || currentPath.value === folder.path) {
      currentPath.value = currentPath.value.replace(folder.path, target);
    }
    await refreshAll();
  } catch (err) {
    error.value = err.message || t('dv.errMoveFolder');
  }
}

async function deleteFolderAction(folder) {
  if (!window.confirm(t('dv.confirmDeleteFolder', { name: folder.name }))) return;
  try {
    await deleteFolder(folder.path, false);
    await refreshAll();
  } catch (err) {
    if (String(err.message || '').includes('not empty')) {
      const recursive = window.confirm(t('dv.confirmDeleteRecursive'));
      if (!recursive) return;
      try {
        await deleteFolder(folder.path, true);
        if (currentPath.value.startsWith(folder.path)) {
          currentPath.value = '';
        }
        await refreshAll();
      } catch (nestedError) {
        error.value = nestedError.message || t('dv.errRecursiveDelete');
      }
      return;
    }
    error.value = err.message || t('dv.errDeleteFolder');
  }
}

async function promptRenameFile(file) {
  const nextName = window.prompt(t('dv.promptRenameFile'), file.metadata?.fileName || file.name);
  if (!nextName) return;
  try {
    await renameFile(file.name, nextName);
    await reloadExplorer();
  } catch (err) {
    error.value = err.message || t('dv.errRename');
  }
}

async function promptMoveFile(file) {
  const target = window.prompt(t('dv.promptMoveFile'), currentPath.value);
  if (target == null) return;
  try {
    await moveFiles([file.name], target);
    await refreshAll();
  } catch (err) {
    error.value = err.message || t('dv.errMove');
  }
}

async function deleteFile(file) {
  if (!window.confirm(t('dv.confirmDeleteFile', { name: file.metadata?.fileName || file.name }))) return;
  try {
    await deleteFiles([file.name]);
    await refreshAll();
  } catch (err) {
    error.value = err.message || t('dv.errDelete');
  }
}

async function promptMoveSelected() {
  const target = window.prompt(t('dv.promptMoveSelected'), currentPath.value);
  if (target == null) return;
  try {
    await moveFiles(selectedFileIds.value, target);
    selectedFileIds.value = [];
    await refreshAll();
  } catch (err) {
    error.value = err.message || t('dv.errBatchMove');
  }
}

async function deleteSelected() {
  if (selectedFileIds.value.length === 0) return;
  if (!window.confirm(t('dv.confirmDeleteSelected', { n: selectedFileIds.value.length }))) return;
  try {
    await deleteFiles(selectedFileIds.value);
    selectedFileIds.value = [];
    await refreshAll();
  } catch (err) {
    error.value = err.message || t('dv.errBatchDelete');
  }
}

function fileLink(id) {
  return absoluteFileUrl(id);
}

async function copyDirect(file) {
  await copyText(fileLink(file.name));
  message.value = t('dv.msgDirectCopied');
}

async function copyShare(file) {
  try {
    const payload = await signShareLink(file.name);
    await copyText(payload.shareUrl);
    const expireAt = payload.expiresAt ? new Date(payload.expiresAt).toLocaleString() : t('dv.expiresNever');
    message.value = t('dv.msgShareCopied', { permission: payload.permission, expireAt });
  } catch (err) {
    error.value = err.message || t('dv.errShareLink');
  }
}

async function copyText(text) {
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

function statusLabel(status) {
  const map = {
    pending: t('dv.stPending'),
    uploading: t('dv.stUploading'),
    success: t('dv.stSuccess'),
    error: t('dv.stError'),
    cancelled: t('dv.stCancelled'),
  };
  return map[status] || status;
}

function isImage(name = '') {
  const ext = String(name).split('.').pop()?.toLowerCase() || '';
  return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'ico', 'avif', 'heic'].includes(ext);
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

function formatTime(timestamp) {
  if (!timestamp) return '-';
  try {
    return new Date(Number(timestamp)).toLocaleString();
  } catch {
    return '-';
  }
}
</script>
