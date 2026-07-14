<template>
  <div class="adapter-grid storage-profile-status-grid">
    <article v-for="profile in profiles" :key="profile.storageId" class="adapter-card">
      <div class="adapter-card-top">
        <strong>{{ profile.storageName }}</strong>
        <span class="badge">{{ getStorageLabel(profile.storageType) }}</span>
        <span class="badge" :class="profile.connected ? 'badge-ok' : 'badge-danger'">
          {{ profile.connected ? t('status.connected') : t('status.unavailable') }}
        </span>
      </div>
      <p class="muted">{{ profile.message }}</p>
      <p class="muted">{{ t('sv.idLabel') }}{{ profile.storageId }}</p>
      <p class="muted">{{ t('sv.enabled') }}: {{ profile.enabled ? t('common.yes') : t('common.no') }}</p>
      <p v-if="profile.errorModel?.detail" class="error">{{ profile.errorModel.detail }}</p>
    </article>
  </div>
</template>

<script setup>
import { getStorageLabel } from '../../config/storage-definitions';
import { useI18n } from '../../i18n';

defineProps({ profiles: { type: Array, required: true } });
const { t } = useI18n();
</script>
