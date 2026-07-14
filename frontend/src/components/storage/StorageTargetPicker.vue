<template>
  <label class="storage-profile-picker">
    <span>{{ t('storage.profile') }}</span>
    <select :value="storageId" :disabled="disabled || !choices.length" @change="choose">
      <option v-for="profile in choices" :key="profile.id" :value="profile.id">
        {{ profile.name }} · {{ profile.isDefault ? t('sv.default') : t('sv.enabled') }}
      </option>
    </select>
    <small v-if="!choices.length" class="muted">{{ t('storage.noEnabledProfiles') }}</small>
    <small v-else-if="notice" class="muted storage-profile-notice">
      {{ t('storage.selectionReset') }}
    </small>
  </label>
</template>

<script setup>
import { computed } from 'vue';
import { useI18n } from '../../i18n';
import { enabledProfilesForType } from '../../utils/storage-profile-selection';

const props = defineProps({
  profiles: { type: Array, default: () => [] },
  storageMode: { type: String, required: true },
  storageId: { type: String, default: '' },
  notice: { type: String, default: '' },
  disabled: { type: Boolean, default: false },
});
const emit = defineEmits(['update:storageId']);
const { t } = useI18n();
const choices = computed(() => enabledProfilesForType(props.profiles, props.storageMode));

function choose(event) {
  emit('update:storageId', event.target.value);
}
</script>
