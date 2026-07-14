<template>
  <div v-if="queue.length" class="list-wrap">
    <h3>{{ t('uv.queue') }}</h3>
    <ul class="list">
      <li v-for="item in queue" :key="item.id" class="list-item">
        <div class="list-title">
          <strong>{{ item.file.name }}</strong>
          <span>{{ formatSize(item.file.size) }}</span>
        </div>
        <p class="muted queue-target">
          {{ targetLabel(item.target) }} · {{ formatFolderPath(item.target.targetFolderPath) }}
        </p>
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
          <p class="muted">{{ targetLabel(item.target) }}</p>
          <p class="muted">{{ item.link }}</p>
        </div>
        <div class="result-actions">
          <button class="btn btn-ghost" @click="$emit('copy', item.link)">{{ t('uv.copy') }}</button>
          <a class="btn btn-ghost" :href="item.link" target="_blank" rel="noopener">{{ t('uv.open') }}</a>
        </div>
      </li>
    </ul>
  </div>
</template>

<script setup>
import { useI18n } from '../../i18n';
import { getStorageLabel } from '../../config/storage-definitions';

defineProps({
  queue: { type: Array, required: true },
  results: { type: Array, required: true },
  formatFolderPath: { type: Function, required: true },
  formatSize: { type: Function, required: true },
  statusLabel: { type: Function, required: true },
});
defineEmits(['copy']);
const { t } = useI18n();

function targetLabel(target) {
  return `${getStorageLabel(target.storageMode)} · ${target.storageName}`;
}
</script>
