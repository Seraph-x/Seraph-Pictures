<template>
  <section class="card panel status-panel">
    <div class="panel-head">
      <div>
        <h2>{{ t('status.title') }}</h2>
        <p class="muted">{{ t('status.subtitle') }}</p>
      </div>
      <button class="btn btn-ghost" @click="loadStatus" :disabled="loading">
        {{ loading ? t('status.refreshing') : t('status.refresh') }}
      </button>
    </div>

    <StorageProfileStatusGrid v-if="storageProfiles.length" :profiles="storageProfiles" />

    <div class="adapter-grid">
      <article v-for="item in adapters" :key="item.type" class="adapter-card">
        <div class="adapter-card-top">
          <strong>{{ item.label }}</strong>
          <span class="badge" :class="item.connected ? 'badge-ok' : 'badge-danger'">
            {{ item.connected ? t('status.connected') : t('status.unavailable') }}
          </span>
        </div>
        <p class="muted">{{ item.message }}</p>
        <p class="muted">{{ t('status.configured') }} {{ item.configured ? t('common.yes') : t('common.no') }} | {{ t('status.layer') }} {{ item.layer }}</p>
        <p v-if="item.errorMessage" class="error">{{ item.errorMessage }}</p>
      </article>
    </div>

    <section class="card-lite diagnostic-card" v-if="telegramDiag">
      <h3>{{ t('status.tgDiag') }}</h3>
      <p class="muted">{{ telegramDiag.summary }}</p>
      <ul class="diag-list">
        <li><strong>{{ t('status.configSource') }}</strong> {{ telegramDiag.configSource || t('status.unknown') }}</li>
        <li><strong>{{ t('status.tokenSource') }}</strong> {{ telegramDiag.tokenSource || t('status.notFound') }}</li>
        <li><strong>{{ t('status.chatIdSource') }}</strong> {{ telegramDiag.chatIdSource || t('status.notFound') }}</li>
        <li><strong>{{ t('status.apiBaseSource') }}</strong> {{ telegramDiag.apiBaseSource || t('status.default') }}</li>
      </ul>
      <ol class="diag-steps">
        <li>{{ t('status.step1') }}</li>
        <li>{{ t('status.step2') }}</li>
        <li>{{ t('status.step3') }}</li>
      </ol>
    </section>

    <p v-if="error" class="error">{{ error }}</p>
  </section>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { apiFetch } from '../api/client';
import StorageProfileStatusGrid from '../components/storage/StorageProfileStatusGrid.vue';
import { useI18n } from '../i18n';

const { t } = useI18n();
const loading = ref(false);
const error = ref('');
const status = ref(null);

const adapters = computed(() => {
  const source = status.value || {};
  const list = Array.isArray(source.capabilities) ? source.capabilities : [];
  return list.map((cap) => {
    const detail = source[cap.type] || {};
    const errorMessage = detail.errorModel?.detail || '';
    return {
      type: cap.type,
      label: cap.label,
      connected: Boolean(detail.connected),
      configured: Boolean(detail.configured),
      layer: cap.layer || detail.layer || 'direct',
      message: detail.message || cap.enableHint || t('status.noData'),
      errorMessage,
    };
  });
});

const telegramDiag = computed(() => status.value?.diagnostics?.telegram || null);
const storageProfiles = computed(() => (
  Array.isArray(status.value?.storageProfiles) ? status.value.storageProfiles : []
));

onMounted(() => {
  void loadStatus();
});

async function loadStatus() {
  loading.value = true;
  error.value = '';
  try {
    status.value = await apiFetch('/api/status');
  } catch (err) {
    error.value = err.message || t('status.loadError');
  } finally {
    loading.value = false;
  }
}
</script>
