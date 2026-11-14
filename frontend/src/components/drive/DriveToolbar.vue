<template>
  <div class="drive-toolbar">
    <div class="breadcrumbs">
      <button
        v-for="crumb in breadcrumbs"
        :key="crumb.path || '__root__'"
        class="crumb"
        @click="$emit('open-path', crumb.path)"
      >
        {{ crumb.name }}
      </button>
    </div>
    <form class="drive-search" role="search" @submit.prevent="$emit('reload')">
      <label for="drive-search">{{ t('dv.searchLabel') }}</label>
      <div class="drive-search-controls">
        <input
          id="drive-search" name="search" type="search" enterkeyhint="search"
          autocapitalize="none" autocorrect="off" :spellcheck="false"
          :value="search" :placeholder="t('dv.searchPh')"
          @input="$emit('update:search', $event.target.value)"
        />
        <button class="btn" type="submit">{{ t('dv.searchButton') }}</button>
      </div>
    </form>
    <div class="toolbar">
      <label for="drive-storage-filter">{{ t('dv.colStorage') }}</label>
      <select
        id="drive-storage-filter"
        data-testid="drive-storage-profile"
        :value="storageId"
        @change="$emit('update:storageId', $event.target.value)"
      >
        <option value="">{{ t('dv.allStorage') }}</option>
        <option v-for="profile in profiles" :key="profile.id" :value="profile.id">
          {{ profileLabel(profile) }}
        </option>
      </select>
      <label for="drive-view-mode">{{ t('dv.viewMode') }}</label>
      <select id="drive-view-mode" :value="viewMode" @change="$emit('update:viewMode', $event.target.value)">
        <option value="list">{{ t('dv.viewList') }}</option>
        <option value="grid">{{ t('dv.viewGrid') }}</option>
      </select>
      <label for="drive-migration-target">{{ t('dv.migrationDestination') }}</label>
      <select
        id="drive-migration-target"
        data-testid="drive-migration-destination"
        :value="migrationDestinationId"
        :disabled="!hasSelection || !migrationDestinations.length"
        @change="$emit('update:migrationDestinationId', $event.target.value)"
      >
        <option value="">{{ t('dv.migrationDestination') }}</option>
        <option v-for="profile in migrationDestinations" :key="profile.id" :value="profile.id">
          {{ profileLabel(profile) }}
        </option>
      </select>
      <button
        class="btn btn-ghost"
        data-testid="drive-migrate"
        :disabled="!hasSelection || !migrationDestinationValid"
        @click="$emit('migrate')"
      >
        {{ t('dv.migrate') }}
      </button>
      <button class="btn btn-ghost" :disabled="!hasSelection" @click="$emit('move')">
        {{ t('dv.move') }}
      </button>
      <button class="btn btn-danger" :disabled="!hasSelection" @click="$emit('delete')">
        {{ t('dv.delete') }}
      </button>
      <p v-if="hasSelection" class="muted" role="status">{{ t('dv.selectedCount', { n: selectedCount }) }}</p>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { getStorageLabel } from '../../config/storage-definitions';
import { useI18n } from '../../i18n';
import { migrationDestinations as enabledDestinations } from '../../utils/drive-profile-contract';

const props = defineProps({
  breadcrumbs: { type: Array, required: true },
  search: { type: String, default: '' },
  storageId: { type: String, default: '' },
  profiles: { type: Array, required: true },
  viewMode: { type: String, required: true },
  selectedCount: { type: Number, required: true },
  migrationDestinationId: { type: String, default: '' },
  sourceStorageIds: { type: Array, default: () => [] },
});
defineEmits([
  'open-path', 'reload', 'move', 'delete', 'migrate',
  'update:search', 'update:storageId', 'update:viewMode', 'update:migrationDestinationId',
]);
const { t } = useI18n();
const hasSelection = computed(() => props.selectedCount > 0);
const migrationDestinations = computed(() => enabledDestinations(props.profiles, props.sourceStorageIds));
const migrationDestinationValid = computed(() => migrationDestinations.value.some(
  (profile) => profile.id === props.migrationDestinationId,
));

function profileLabel(profile) {
  const state = profile.enabled ? t('sv.enabled') : t('sv.disabled');
  return `${getStorageLabel(profile.type)} · ${profile.name} · ${state}`;
}
</script>

<style scoped>
.drive-search { display: grid; gap: 6px; }
.drive-search-controls { display: flex; gap: 8px; }
.drive-search-controls input { flex: 1; min-width: 0; font-size: 1rem; }
.drive-search-controls button { flex-shrink: 0; }
.toolbar > label { width: 100%; }
.drive-search button:focus-visible,
.drive-search input:focus-visible { outline: 2px solid var(--text); outline-offset: 2px; }
</style>
