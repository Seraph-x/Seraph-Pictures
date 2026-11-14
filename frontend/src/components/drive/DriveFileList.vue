<template>
  <div v-if="error" class="drive-list-feedback" role="alert">
    <p class="error">{{ t('dv.errLoadExplorer') }}：{{ error }}</p>
    <button class="btn btn-ghost" @click="$emit('retry')">{{ t('dv.retry') }}</button>
  </div>
  <div v-if="loading" class="drive-list-loading">
    <progress :aria-label="t('dv.loading')" />
    <span class="muted">{{ t('dv.loading') }}</span>
  </div>
  <div v-if="folders.length" class="folder-inline-list">
    <article v-for="folder in folders" :key="folder.path" class="folder-card">
      <button class="folder-open" @click="$emit('open-folder', folder.path)">
        <strong>{{ folder.name }}</strong>
        <small>{{ folder.fileCount }} {{ t('dv.files') }}</small>
      </button>
      <div class="folder-card-actions">
        <button class="btn btn-ghost" @click="$emit('rename-folder', folder)">{{ t('dv.rename') }}</button>
        <button class="btn btn-ghost" @click="$emit('move-folder', folder)">{{ t('dv.move') }}</button>
        <button class="btn btn-danger" @click="$emit('delete-folder', folder)">{{ t('dv.delete') }}</button>
      </div>
    </article>
  </div>

  <label v-if="viewMode === 'grid' && files.length" class="drive-select-all">
    <input
      type="checkbox" :checked="allSelected" :indeterminate="selectedSet.size > 0 && !allSelected"
      @change="$emit('toggle-all')"
    />
    {{ t('dv.selectAll') }}
  </label>
  <div v-if="viewMode === 'grid' && files.length" class="file-grid">
    <article v-for="file in files" :key="file.name" class="file-card">
      <label class="file-check">
        <input
          type="checkbox"
          :aria-label="t('dv.selectFile', { name: file.metadata?.fileName || file.name })"
          :checked="selectedSet.has(file.name)"
          @change="$emit('toggle-file', file.name)"
        />
      </label>
      <a :href="fileLink(file.name)" target="_blank" rel="noopener" class="file-preview">
        <img
          v-if="isImage(file.metadata?.fileName || file.name)"
          :src="fileLink(file.name)"
          :alt="file.metadata?.fileName || file.name"
          loading="lazy" decoding="async"
        />
        <span v-else>{{ t('dv.filePlaceholder') }}</span>
      </a>
      <strong class="file-name">{{ file.metadata?.fileName || file.name }}</strong>
      <small class="muted">{{ storageLabel(file) }}</small>
      <small class="muted">{{ formatSize(file.metadata?.fileSize || 0) }}</small>
      <div class="file-actions">
        <button class="btn btn-ghost" @click="$emit('direct', file)">{{ t('dv.direct') }}</button>
        <button class="btn btn-ghost" @click="$emit('share', file)">{{ t('dv.share') }}</button>
        <button class="btn btn-ghost" @click="$emit('rename-file', file)">{{ t('dv.rename') }}</button>
        <button class="btn btn-ghost" @click="$emit('move-file', file)">{{ t('dv.move') }}</button>
        <button class="btn btn-danger" @click="$emit('delete-file', file)">{{ t('dv.delete') }}</button>
      </div>
    </article>
  </div>

  <div v-else-if="files.length" class="table-wrap">
    <table class="table">
      <thead>
        <tr>
          <th><input
            type="checkbox" :checked="allSelected" :aria-label="t('dv.selectAll')"
            :indeterminate="selectedSet.size > 0 && !allSelected" @change="$emit('toggle-all')"
          /></th>
          <th>{{ t('dv.colName') }}</th>
          <th>{{ t('dv.colStorage') }}</th>
          <th>{{ t('dv.colSize') }}</th>
          <th>{{ t('dv.colUpdated') }}</th>
          <th>{{ t('dv.colActions') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="file in files" :key="file.name">
          <td>
            <input
              type="checkbox"
              :aria-label="t('dv.selectFile', { name: file.metadata?.fileName || file.name })"
              :checked="selectedSet.has(file.name)"
              @change="$emit('toggle-file', file.name)"
            />
          </td>
          <td>
            <div class="file-col">
              <strong>{{ file.metadata?.fileName || file.name }}</strong>
              <small>{{ file.name }}</small>
            </div>
          </td>
          <td>
            <span class="badge" :title="file.metadata?.storageId || ''">{{ storageLabel(file) }}</span>
          </td>
          <td>{{ formatSize(file.metadata?.fileSize || 0) }}</td>
          <td>{{ formatTime(file.metadata?.TimeStamp) }}</td>
          <td>
            <div class="table-actions">
              <button class="btn btn-ghost" @click="$emit('direct', file)">{{ t('dv.direct') }}</button>
              <button class="btn btn-ghost" @click="$emit('share', file)">{{ t('dv.share') }}</button>
              <button class="btn btn-ghost" @click="$emit('rename-file', file)">{{ t('dv.rename') }}</button>
              <button class="btn btn-ghost" @click="$emit('move-file', file)">{{ t('dv.move') }}</button>
              <button class="btn btn-danger" @click="$emit('delete-file', file)">{{ t('dv.delete') }}</button>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  </div>

  <div v-if="!loading && !error && files.length === 0" class="drive-list-empty">
    <p v-if="nextCursor" class="muted">{{ t('dv.emptyPage') }}</p>
    <template v-else>
      <p>{{ filtered ? t('dv.noResults') : t('dv.emptyFolder') }}</p>
      <button v-if="filtered" class="btn btn-ghost" @click="$emit('clear-filters')">
        {{ t('dv.clearFilters') }}
      </button>
    </template>
  </div>
  <div class="footer-actions">
    <button v-if="nextCursor && !error" class="btn" :disabled="loading" @click="$emit('load-more')">
      {{ loading ? t('dv.loading') : t('dv.loadMore') }}
    </button>
  </div>
</template>

<script setup>
import { getStorageLabel } from '../../config/storage-definitions';
import { useI18n } from '../../i18n';

defineProps({
  folders: { type: Array, required: true }, files: { type: Array, required: true },
  viewMode: { type: String, required: true }, selectedSet: { type: Set, required: true },
  allSelected: { type: Boolean, required: true }, loading: { type: Boolean, required: true },
  error: { type: String, default: '' }, filtered: { type: Boolean, default: false },
  nextCursor: { type: [String, Number], default: null },
  fileLink: { type: Function, required: true }, formatSize: { type: Function, required: true },
  formatTime: { type: Function, required: true },
});
defineEmits([
  'open-folder', 'rename-folder', 'move-folder', 'delete-folder', 'toggle-file', 'toggle-all',
  'load-more', 'retry', 'clear-filters', 'direct', 'share', 'rename-file', 'move-file', 'delete-file',
]);
const { t } = useI18n();

function storageLabel(file) {
  const metadata = file.metadata || {};
  return `${getStorageLabel(metadata.storageType)} · ${metadata.storageName || t('dv.unknown')}`;
}
function isImage(name = '') {
  const extension = String(name).split('.').pop()?.toLowerCase() || '';
  return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'ico', 'avif', 'heic'].includes(extension);
}
</script>

<style scoped>
.drive-list-feedback { display: grid; justify-items: start; gap: 8px; overflow-wrap: anywhere; }
.drive-list-feedback p { margin: 0; }
.drive-list-loading { display: flex; align-items: center; gap: 12px; }
.drive-list-loading progress { max-width: 8rem; accent-color: var(--text); }
.drive-list-empty { padding-block: 24px; text-align: center; }
.drive-list-empty p { margin: 0 0 12px; }
.drive-select-all { display: flex; align-items: center; gap: 8px; }
</style>
