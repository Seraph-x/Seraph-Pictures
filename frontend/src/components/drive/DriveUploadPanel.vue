<template>
  <section class="adapter-visibility card-lite">
    <div class="adapter-visibility-head">
      <h3>{{ t('dv.capVisibility') }}</h3>
      <p class="muted">{{ t('dv.capVisibilityNote') }}</p>
    </div>
    <div class="adapter-grid">
      <article
        v-for="capability in capabilities"
        :key="capability.type"
        class="adapter-card"
        :class="{ active: selectedStorage === capability.type, unavailable: !capability.available }"
        @click="capability.available && $emit('select-storage', capability.type)"
      >
        <div class="adapter-card-top">
          <strong>{{ capability.label }}</strong>
          <span class="badge">{{ capability.layerLabel }}</span>
        </div>
        <p class="muted">{{ capability.description }}</p>
        <p class="adapter-status" :class="capability.available ? 'ok' : 'fail'">
          {{ capability.statusText }}
        </p>
        <p class="adapter-hint">{{ capability.hint }}</p>
      </article>
    </div>
    <StorageTargetPicker
      :storage-id="selectedStorageId"
      :profiles="profiles"
      :storage-mode="selectedStorage"
      :notice="selectionNotice"
      @update:storage-id="$emit('update:storageId', $event)"
    />
  </section>

  <section
    class="drive-dropzone"
    :class="{ active: dragActive }"
    @dragover.prevent="$emit('update:dragActive', true)"
    @dragleave.prevent="$emit('update:dragActive', false)"
    @drop.prevent="$emit('drop', $event)"
    @click="$refs.pickerInput.click()"
  >
    <input ref="pickerInput" type="file" multiple hidden @change="$emit('file-pick', $event)" />
    <p class="dropzone-title">{{ t('dv.dropTitle') }}</p>
    <p class="muted">
      {{ t('dv.currentStorage') }} {{ currentStorageLabel }} |
      {{ t('dv.folder') }} /{{ currentPath || '' }}
    </p>
  </section>

  <ImageProcessingPanel
    :model-value="imageProcessing"
    :active-format="activeImageFormat"
    :format-options="formatOptions"
    :summary="imageSummary"
    @update:model-value="$emit('update:imageProcessing', $event)"
    @select-format="$emit('select-format', $event)"
  />
  <section class="image-upload-behavior card-lite">
    <div>
      <h3>{{ t('dv.imgBehavior') }}</h3>
      <p class="muted">{{ imageDecisionSummary }}</p>
    </div>
    <div class="format-segments">
      <button
        v-for="option in imageDecisionOptions"
        :key="option.value"
        class="chip"
        :class="{ active: imageDecision === option.value }"
        type="button"
        @click="$emit('select-decision', option.value)"
      >
        {{ option.label }}
      </button>
    </div>
  </section>
  <form class="url-row" @submit.prevent="$emit('upload-url')">
    <input
      :value="urlInput"
      placeholder="https://example.com/file.zip"
      @input="$emit('update:urlInput', $event.target.value.trim())"
    />
    <button class="btn" :disabled="urlUploading || !urlInput">
      {{ urlUploading ? t('dv.uploading') : t('dv.uploadUrlBtn') }}
    </button>
  </form>
  <UploadQueue
    :queue="queue"
    :results="results"
    :format-folder-path="formatFolderPath"
    :format-size="formatSize"
    :status-label="statusLabel"
    controls
    @copy="$emit('copy', $event)"
    @retry="$emit('retry', $event)"
    @cancel="$emit('cancel', $event)"
  />
</template>

<script setup>
import ImageProcessingPanel from '../ImageProcessingPanel.vue';
import StorageTargetPicker from '../storage/StorageTargetPicker.vue';
import UploadQueue from '../upload/UploadQueue.vue';
import { useI18n } from '../../i18n';

defineProps({
  capabilities: { type: Array, required: true }, profiles: { type: Array, required: true },
  selectionNotice: { type: String, default: '' }, selectedStorage: { type: String, required: true },
  selectedStorageId: { type: String, default: '' }, currentStorageLabel: { type: String, required: true },
  currentPath: { type: String, default: '' }, dragActive: { type: Boolean, required: true },
  imageProcessing: { type: Object, required: true }, activeImageFormat: { type: String, required: true },
  formatOptions: { type: Array, required: true }, imageSummary: { type: String, required: true },
  imageDecision: { type: String, required: true }, imageDecisionOptions: { type: Array, required: true },
  imageDecisionSummary: { type: String, required: true }, urlInput: { type: String, default: '' },
  urlUploading: { type: Boolean, required: true }, queue: { type: Array, required: true },
  results: { type: Array, required: true }, formatSize: { type: Function, required: true },
});
defineEmits([
  'select-storage', 'update:storageId', 'update:dragActive', 'drop', 'file-pick',
  'update:imageProcessing', 'select-format', 'select-decision', 'update:urlInput', 'upload-url', 'copy',
  'retry', 'cancel',
]);
const { t } = useI18n();

function formatFolderPath(path) { return path ? `/${path}` : '/'; }
function statusLabel(value) {
  const key = {
    pending: 'dv.stPending', uploading: 'dv.stUploading', success: 'dv.stSuccess',
    error: 'dv.stError', cancelled: 'dv.stCancelled',
  }[value];
  return key ? t(key) : value;
}
</script>
