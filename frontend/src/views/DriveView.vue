<template>
  <section class="card panel drive-panel">
    <header class="drive-header">
      <div><h2>{{ t('dv.title') }}</h2><p class="muted">{{ t('dv.subtitle') }}</p></div>
      <div class="drive-head-actions">
        <button class="btn btn-ghost" @click="refreshAll">{{ t('dv.refresh') }}</button>
      </div>
    </header>

    <DriveUploadPanel
      :capabilities="capabilityCards"
      :profiles="storageProfiles.profiles.value"
      :selection-notice="storageProfiles.notice.value"
      :selected-storage="selectedStorage"
      :selected-storage-id="selectedStorageId"
      :current-storage-label="currentStorageLabel"
      :current-path="currentPath"
      :drag-active="dragActive"
      :image-processing="imageProcessing"
      :active-image-format="activeImageFormat"
      :format-options="imageProcessingFormatOptions"
      :image-summary="imageProcessingSummary"
      :image-decision="imageUploadDecision"
      :image-decision-options="imageDecisionOptions"
      :image-decision-summary="imageDecisionSummary"
      :url-input="urlInput"
      :url-uploading="urlUploading"
      :queue="queue"
      :results="results"
      :format-size="formatSize"
      @select-storage="selectStorageMode"
      @update:storage-id="selectedStorageId = $event"
      @update:drag-active="dragActive = $event"
      @drop="handleDrop"
      @file-pick="handleFilePick"
      @update:image-processing="imageProcessing = $event"
      @select-format="selectImageFormat"
      @select-decision="setImageUploadDecision"
      @update:url-input="urlInput = $event"
      @upload-url="uploadUrl"
      @copy="copyText"
      @retry="retryUpload"
      @cancel="cancelUpload"
    />

    <div class="drive-layout">
      <aside class="folder-tree card-lite">
        <div class="folder-tree-head">
          <h3>{{ t('dv.folders') }}</h3>
          <button class="btn btn-ghost" @click="mutations.createFolder">{{ t('dv.new') }}</button>
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
              <span>{{ node.name }}</span><small>{{ node.fileCount }}</small>
            </button>
          </li>
        </ul>
      </aside>

      <article class="drive-main card-lite">
        <DriveToolbar
          :breadcrumbs="breadcrumbs"
          :search="search"
          :storage-id="storageId"
          :profiles="storageProfiles.profiles.value"
          :view-mode="viewMode"
          :selected-count="selectedFileIds.length"
          :migration-destination-id="migrationDestinationId"
          :source-storage-ids="selectedSourceStorageIds"
          @open-path="openPath"
          @reload="reloadExplorer"
          @update:search="search = $event"
          @update:storage-id="changeStorageFilter"
          @update:view-mode="viewMode = $event"
          @update:migration-destination-id="migrationDestinationId = $event"
          @migrate="mutations.migrateSelected(migrationDestinationId)"
          @move="mutations.moveSelected"
          @delete="mutations.deleteSelected"
        />
        <DriveFileList
          :folders="folders" :files="files" :view-mode="viewMode"
          :selected-set="selectedSet" :all-selected="allSelected"
          :loading="loading" :next-cursor="nextCursor"
          :file-link="fileLink" :format-size="formatSize" :format-time="formatTime"
          @open-folder="openPath" @rename-folder="mutations.renameFolder"
          @move-folder="mutations.moveFolder" @delete-folder="mutations.deleteFolder"
          @toggle-file="toggleFileSelection" @toggle-all="toggleSelectAll" @load-more="loadMore"
          @direct="mutations.copyDirect" @share="mutations.copyShare"
          @rename-file="mutations.renameFile" @move-file="mutations.moveFile"
          @delete-file="mutations.deleteFile"
        />
      </article>
    </div>
    <p v-if="message" class="muted">{{ message }}</p>
    <p v-if="error" class="error">{{ error }}</p>
  </section>

  <UploadPreparationDialog
    v-if="pendingUploadBatch"
    v-model:image-processing="imageProcessing"
    :active-format="activeImageFormat" :batch="pendingUploadBatch"
    :format-options="imageProcessingFormatOptions" :format-size="formatSize"
    :summary="imageProcessingSummary"
    @cancel="cancelPendingUpload" @select-format="selectImageFormat"
    @upload-original="uploadPendingOriginal" @upload-optimized="uploadPendingOptimized"
  />
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { apiFetch, absoluteFileUrl } from '../api/client';
import * as driveApi from '../api/drive';
import DriveFileList from '../components/drive/DriveFileList.vue';
import DriveToolbar from '../components/drive/DriveToolbar.vue';
import DriveUploadPanel from '../components/drive/DriveUploadPanel.vue';
import UploadPreparationDialog from '../components/UploadPreparationDialog.vue';
import { useDriveExplorer } from '../composables/drive/useDriveExplorer';
import { useDriveMutations } from '../composables/drive/useDriveMutations';
import { useDriveUpload } from '../composables/drive/useDriveUpload';
import { useStorageProfiles } from '../composables/storage/useStorageProfiles';
import { STORAGE_TYPES, getStorageLabel } from '../config/storage-definitions';
import { useI18n } from '../i18n';

const { t } = useI18n();
const storageProfiles = useStorageProfiles();
const status = ref(null);
const message = ref('');
const migrationDestinationId = ref('');
const explorer = useDriveExplorer({ api: driveApi, t });
const {
  folders, files, breadcrumbs, currentPath, storageId, search, nextCursor, loading, viewMode,
  selectedFileIds, error, selectedSet, allSelected, flatTreeNodes, refreshAll, reloadExplorer,
  loadMore, openPath, toggleFileSelection, toggleSelectAll,
} = explorer;
const upload = useDriveUpload({ t, profiles: storageProfiles, status, currentPath, error, refreshAll });
const {
  dragActive, queue, results, urlInput, urlUploading, pendingUploadBatch, selectedStorage,
  selectedStorageId, formatSize, handleDrop, handleFilePick, uploadUrl, selectStorageMode,
  cancelPendingUpload, uploadPendingOriginal, uploadPendingOptimized,
  cancelUpload, retryUpload,
} = upload;
const {
  imageProcessing, activeImageFormat, imageProcessingFormatOptions, imageProcessingSummary,
  refreshImageProcessingSupport, selectImageFormat, imageUploadDecision,
  setImageUploadDecision,
} = upload.image;
const mutations = useDriveMutations({
  ...driveApi, api: driveApi, t, error, message, currentPath, selectedFileIds,
  refreshAll, reloadExplorer, fileLink: absoluteFileUrl,
});

const capabilityCards = computed(() => STORAGE_TYPES.map((item) => {
  const available = storageProfiles.choices(item.value).length > 0;
  const detail = status.value?.[item.value] || {};
  return {
    type: item.value, label: item.label, description: item.description,
    layerLabel: item.layer === 'mounted' ? t('dv.layerMounted') : t('dv.layerDirect'),
    available, statusText: available ? t('dv.stAvailable') : t('dv.stNotConfigured'),
    hint: available ? t('dv.hintReady') : (detail.message || t('dv.hintConfigureToEnable')),
  };
}));
const currentStorageLabel = computed(() => {
  const profile = storageProfiles.selectedProfile(selectedStorage.value);
  return profile ? `${getStorageLabel(profile.type)} · ${profile.name}` : getStorageLabel(selectedStorage.value);
});
const imageDecisionOptions = computed(() => [
  { value: 'original', label: t('dv.optOriginal') },
  { value: 'optimized', label: t('dv.optOptimized') },
  { value: 'ask', label: t('dv.optAsk') },
]);
const imageDecisionSummary = computed(() => ({
  optimized: t('dv.decOptimized'), ask: t('dv.decAsk'), original: t('dv.decOriginal'),
}[imageUploadDecision.value]));
const selectedSourceStorageIds = computed(() => [...new Set(files.value
  .filter((file) => selectedSet.value.has(file.name))
  .map((file) => file.metadata?.storageId)
  .filter(Boolean))]);

onMounted(async () => {
  await refreshImageProcessingSupport();
  try {
    await storageProfiles.refresh();
    status.value = await apiFetch('/api/status');
    const first = STORAGE_TYPES.find((item) => storageProfiles.choices(item.value).length);
    if (first) selectStorageMode(first.value);
    await refreshAll();
  } catch (cause) {
    error.value = cause.message || t('dv.errLoadStatus');
  }
});
async function changeStorageFilter(id) {
  storageId.value = id;
  if (migrationDestinationId.value === id) migrationDestinationId.value = '';
  await refreshAll();
}
function fileLink(id) { return absoluteFileUrl(id); }
function formatTime(timestamp) { return timestamp ? new Date(Number(timestamp)).toLocaleString() : '-'; }
async function copyText(text) { await navigator.clipboard.writeText(text); }
</script>
