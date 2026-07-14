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
          @click="selectStorageMode(mode.value)"
        >
          {{ mode.label }}
        </button>
      </div>
      <StorageTargetPicker
        v-model:storage-id="selectedStorageId"
        :profiles="storageProfiles.profiles.value"
        :storage-mode="selectedStorage"
        :notice="storageProfiles.notice.value"
      />
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
    <UploadFolderPicker
      v-model="targetFolderPathModel"
      :browser-available="folderBrowserAvailable"
      :folder-hint="folderHint"
      :load-error="folderLoadError"
      :loading="folderLoading"
      :options="folderOptions"
      :target-badge="targetFolderBadge"
      :target-exists="targetFolderExists"
      :target-path="targetFolderPath"
      :format-folder-path="formatFolderPath"
      @reload="reloadFolderTree"
      @use-root="setTargetFolder('')"
    />
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
    <UploadQueue
      :queue="queue"
      :results="results"
      :format-folder-path="formatFolderPath"
      :format-size="formatSize"
      :status-label="statusLabel"
      @copy="copy"
    />
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
import StorageTargetPicker from '../components/storage/StorageTargetPicker.vue';
import UploadPreparationDialog from '../components/UploadPreparationDialog.vue';
import UploadFolderPicker from '../components/upload/UploadFolderPicker.vue';
import UploadQueue from '../components/upload/UploadQueue.vue';
import { useStorageProfiles } from '../composables/storage/useStorageProfiles';
import { useUploadFolders } from '../composables/upload/useUploadFolders';
import { useUploadQueue } from '../composables/upload/useUploadQueue';
import { humanizeUploadError, useUploadTransport } from '../composables/upload/useUploadTransport';
import { useImageProcessing } from '../composables/useImageProcessing';
import { STORAGE_TYPES, getStorageLabel, getUploadLimit } from '../config/storage-definitions';
import { useI18n } from '../i18n';
import { isImageProcessable } from '../utils/image-processing';
import { createMultipartDigestPlan } from '../utils/multipart-digest';
import { snapshotStorageTarget } from '../utils/storage-profile-selection';
const CHUNK_SIZE = 5 * 1024 * 1024;
const ACCEPT = 'application/vnd.seraph.v2+json, application/json;q=0.9, text/plain;q=0.5, */*;q=0.1';
const JSON_HEADERS = Object.freeze({ 'Content-Type': 'application/json', Accept: ACCEPT, 'X-Seraph-Client': 'app-v2' });
const UPLOAD_HEADERS = Object.freeze({ Accept: ACCEPT, 'X-Seraph-Client': 'app-v2' });
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
const pendingUploadBatch = ref(null);
const storageProfiles = useStorageProfiles();
const folders = useUploadFolders({ getDriveTree, selectedStorage, t });
const {
  folderBrowserAvailable, folderHint, folderLoadError, folderLoading, folderOptions,
  targetFolderBadge, targetFolderExists, targetFolderPath, targetFolderPathModel,
  formatFolderPath, loadFolderTree, reloadFolderTree, setTargetFolder,
} = folders;
const image = useImageProcessing({ formatSize });
const {
  imageProcessing, activeImageFormat, imageProcessingFormatOptions, imageProcessingSummary,
  refreshImageProcessingSupport, selectImageFormat, getImageProcessingSnapshot,
  getImageProcessingSnapshotForDecision, imageUploadDecision, setImageUploadDecision,
  prepareQueuedImage,
} = image;
const imageUploadDecisionOptions = computed(() => [
  { value: 'original', label: t('uv.optOriginal') },
  { value: 'optimized', label: t('uv.optOptimized') },
  { value: 'ask', label: t('uv.optAsk') },
]);
const imageUploadDecisionSummary = computed(() => ({
  optimized: t('uv.decOptimized'), ask: t('uv.decAsk'), original: t('uv.decOriginal'),
}[imageUploadDecision.value]));
const modes = computed(() => STORAGE_TYPES.map((item) => {
  const detail = status.value?.[item.value] || {};
  const available = storageProfiles.choices(item.value).length > 0;
  return {
    value: item.value, label: item.label, available,
    hint: available ? t('uv.hintReady')
      : (detail.configured ? detail.message || t('uv.hintConfiguredUnavailable') : t('uv.hintNotConfigured')),
  };
}));
const currentStorageLabel = computed(() => {
  const typeLabel = modes.value.find((item) => item.value === selectedStorage.value)?.label || getStorageLabel('telegram');
  const profile = storageProfiles.selectedProfile(selectedStorage.value);
  return profile ? `${typeLabel} · ${profile.name}` : typeLabel;
});
const selectedStorageId = computed({
  get: () => storageProfiles.selectedProfile(selectedStorage.value)?.id || '',
  set: (id) => storageProfiles.select(selectedStorage.value, id),
});

function toAbsoluteUrl(path) { return new URL(path, window.location.origin).toString(); }
const transport = useUploadTransport({
  apiFetch, apiUrl: (path) => `${getApiBase()}${path}`, accept: ACCEPT,
  jsonHeaders: JSON_HEADERS, uploadHeaders: UPLOAD_HEADERS, chunkSize: CHUNK_SIZE,
  createDigestPlan: createMultipartDigestPlan, t, toAbsoluteUrl,
  onProgress: (item, progress) => { item.progress = progress; },
  onMultipartStart: (item, id) => { item.multipartUploadId = id; },
  onMultipartFinish: (item) => { item.multipartUploadId = null; },
});
const queueController = useUploadQueue({
  queue, results, uploading, error, profiles: storageProfiles.profiles, status,
  apiFetch, transport, prepareQueuedImage, getUploadLimit, formatSize, t, chunkSize: CHUNK_SIZE,
  humanizeError: (message) => humanizeUploadError(message, t),
  createId: () => `${Date.now()}_${Math.random().toString(16).slice(2)}`,
});

onMounted(async () => {
  await refreshImageProcessingSupport();
  try {
    await storageProfiles.refresh();
    status.value = await apiFetch('/api/status');
    const first = modes.value.find((item) => item.available);
    if (!first) throw new Error('STORAGE_SELECTION_REQUIRED');
    selectStorageMode(first.value);
  } catch (cause) {
    error.value = cause.message;
  } finally {
    await loadFolderTree();
  }
});
watch(selectedStorage, () => { void loadFolderTree(); });

function selectStorageMode(storageMode) {
  selectedStorage.value = storageMode;
  storageProfiles.resolve(storageMode);
}
function createUploadContext() {
  return snapshotStorageTarget({
    storageMode: selectedStorage.value,
    profile: storageProfiles.selectedProfile(selectedStorage.value),
    targetFolderPath: targetFolderPath.value,
  });
}
function openPicker() { picker.value?.click(); }
function handleFilePick(event) {
  prepareFilesForUpload(Array.from(event.target.files || []));
  event.target.value = '';
}
function handleDrop(event) {
  dragActive.value = false;
  prepareFilesForUpload(Array.from(event.dataTransfer?.files || []));
}
function prepareFilesForUpload(files) {
  if (!files.length) return;
  const imageCount = files.filter((file) => isImageProcessable(file)).length;
  let context;
  try {
    context = createUploadContext();
  } catch (cause) {
    error.value = cause.message;
    return;
  }
  if (imageCount > 0 && imageUploadDecision.value === 'ask') {
    pendingUploadBatch.value = { files, imageCount, context };
    return;
  }
  const decision = imageCount > 0 ? imageUploadDecision.value : 'original';
  queueController.enqueue(files, context, getImageProcessingSnapshotForDecision(decision));
}
function cancelPendingUpload() { pendingUploadBatch.value = null; }
function uploadPending(enabled) {
  const batch = pendingUploadBatch.value;
  if (!batch) return;
  pendingUploadBatch.value = null;
  queueController.enqueue(batch.files, batch.context, { ...getImageProcessingSnapshot(), enabled });
}
function uploadPendingOriginal() { uploadPending(false); }
function uploadPendingOptimized() { uploadPending(true); }
async function uploadUrl() {
  if (!urlInput.value || urlUploading.value) return;
  urlUploading.value = true;
  error.value = '';
  let target;
  try {
    target = createUploadContext();
    const link = await transport.uploadUrl({ url: urlInput.value, target });
    results.value.unshift({
      id: `url_${Date.now()}`, fileName: urlInput.value.split('/').pop() || 'remote-file', link, target,
    });
    urlInput.value = '';
  } catch (cause) {
    const message = humanizeUploadError(cause.message || t('uv.errUrlUploadFailed'), t);
    const targetLabel = target
      ? `${getStorageLabel(target.storageMode)} · ${target.storageName}`
      : currentStorageLabel.value;
    error.value = `${targetLabel}: ${message}`;
  } finally {
    urlUploading.value = false;
  }
}
function formatSize(bytes = 0) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) { value /= 1024; index += 1; }
  return `${value.toFixed(index === 0 ? 0 : 2)} ${units[index]}`;
}
function statusLabel(value) {
  const key = { pending: 'uv.stPending', uploading: 'uv.stUploading', success: 'uv.stSuccess', error: 'uv.stError' }[value];
  return key ? t(key) : value;
}
async function copy(text) {
  await navigator.clipboard.writeText(text);
}
</script>
