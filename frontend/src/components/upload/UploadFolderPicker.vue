<template>
  <section class="target-directory card-lite">
    <div class="target-directory-head">
      <div>
        <h3>{{ t('uv.targetDir') }}</h3>
        <p class="muted">{{ t('uv.targetDirDesc') }}</p>
      </div>
      <div class="target-directory-actions">
        <button class="btn btn-ghost" type="button" :disabled="loading" @click="$emit('reload')">
          {{ loading ? t('uv.refreshing') : t('uv.refreshFolders') }}
        </button>
        <button class="btn btn-ghost" type="button" @click="$emit('use-root')">{{ t('uv.useRoot') }}</button>
      </div>
    </div>
    <div class="target-directory-grid">
      <label class="target-directory-field">
        <span>{{ t('uv.folderBrowser') }}</span>
        <select :value="modelValue" :disabled="loading || !browserAvailable" @change="update">
          <option v-for="option in options" :key="option.value || '__root__'" :value="option.value">
            {{ option.label }}
          </option>
        </select>
      </label>
      <label class="target-directory-field">
        <span>{{ t('uv.manualPath') }}</span>
        <input :value="modelValue" placeholder="assets/images/2026" @input="update" />
      </label>
    </div>
    <div class="target-directory-meta">
      <span class="badge" :class="targetExists ? 'badge-ok' : ''">{{ targetBadge }}</span>
      <span class="muted">{{ t('uv.currentFolder') }} {{ formatFolderPath(targetPath) }}</span>
    </div>
    <p class="muted">{{ folderHint }}</p>
    <p v-if="loadError" class="error">{{ loadError }}</p>
  </section>
</template>

<script setup>
import { useI18n } from '../../i18n';

defineProps({
  browserAvailable: Boolean, folderHint: String, formatFolderPath: Function,
  loadError: String, loading: Boolean, modelValue: String, options: Array,
  targetBadge: String, targetExists: Boolean, targetPath: String,
});
const emit = defineEmits(['reload', 'update:modelValue', 'use-root']);
const { t } = useI18n();

function update(event) {
  emit('update:modelValue', event.target.value);
}
</script>
