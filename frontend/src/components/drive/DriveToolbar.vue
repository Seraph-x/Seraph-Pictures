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
    <div class="toolbar">
      <input
        :value="search"
        :placeholder="t('dv.searchPh')"
        @input="$emit('update:search', $event.target.value)"
        @keyup.enter="$emit('reload')"
      />
      <select
        data-testid="drive-storage-profile"
        :value="storageId"
        @change="$emit('update:storageId', $event.target.value)"
      >
        <option value="">{{ t('dv.allStorage') }}</option>
        <option v-for="profile in profiles" :key="profile.id" :value="profile.id">
          {{ profileLabel(profile) }}
        </option>
      </select>
      <select :value="viewMode" @change="$emit('update:viewMode', $event.target.value)">
        <option value="list">{{ t('dv.viewList') }}</option>
        <option value="grid">{{ t('dv.viewGrid') }}</option>
      </select>
      <select
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
