<template>
  <article class="storage-list card-lite">
    <h3>{{ t('sv.configuredBackends') }}</h3>

    <label v-if="items.length">
      {{ t('sv.profileSelector') }}
      <select
        data-testid="storage-profile-select"
        :value="selectedId"
        @change="$emit('select', $event.target.value)"
      >
        <optgroup
          v-for="group in groupedItems"
          :key="group.type"
          :label="getStorageLabel(group.type)"
        >
          <option v-for="item in group.items" :key="item.id" :value="item.id">
            {{ item.name }}{{ item.isDefault ? ` (${t('sv.default')})` : '' }}
          </option>
        </optgroup>
      </select>
    </label>

    <ul v-if="items.length" class="list storage-listing">
      <li v-for="item in items" :key="item.id" class="storage-row">
        <div class="storage-row-main">
          <div class="storage-row-top">
            <strong>{{ item.name }}</strong>
            <span class="badge">{{ getStorageLabel(item.type) }}</span>
            <span class="badge" :class="item.enabled ? 'badge-ok' : 'badge-danger'">
              {{ item.enabled ? t('sv.enabled') : t('sv.disabled') }}
            </span>
            <span v-if="item.isDefault" class="badge">{{ t('sv.default') }}</span>
          </div>
          <p class="muted">{{ t('sv.idLabel') }}{{ item.id }}</p>
          <p
            v-if="testResults[item.id]"
            class="storage-test"
            :class="testResults[item.id].connected ? 'ok' : 'fail'"
          >
            {{ formatTestMessage(testResults[item.id]) }}
          </p>
        </div>

        <div class="storage-actions">
          <button
            class="btn btn-ghost"
            :data-testid="selectedTestId(item, 'edit')"
            @click="$emit('edit', profileSnapshot(item))"
          >{{ t('sv.edit') }}</button>
          <button
            class="btn btn-ghost"
            :data-testid="selectedTestId(item, 'test')"
            @click="$emit('test', item.id)"
          >{{ t('sv.test') }}</button>
          <button
            class="btn btn-ghost"
            :data-testid="selectedTestId(item, 'toggle')"
            :disabled="item.isDefault"
            @click="$emit('toggle', profileSnapshot(item))"
          >{{ item.enabled ? t('sv.disable') : t('sv.enable') }}</button>
          <button
            class="btn btn-ghost"
            :data-testid="selectedTestId(item, 'default')"
            :disabled="item.isDefault || !item.enabled"
            @click="$emit('default', item.id)"
          >{{ t('sv.setDefault') }}</button>
          <button
            class="btn btn-danger"
            :data-testid="selectedTestId(item, 'delete')"
            :disabled="item.isDefault"
            @click="$emit('delete', profileSnapshot(item))"
          >{{ t('sv.delete') }}</button>
        </div>
      </li>
    </ul>
    <p v-else class="muted">{{ t('sv.noConfig') }}</p>
  </article>
</template>

<script setup>
import { computed } from 'vue';
import { getStorageLabel } from '../../config/storage-definitions';
import { useI18n } from '../../i18n';

const props = defineProps({
  items: { type: Array, required: true },
  selectedId: { type: String, required: true },
  testResults: { type: Object, required: true },
});

defineEmits(['default', 'delete', 'edit', 'select', 'test', 'toggle']);

const { t } = useI18n();
const groupedItems = computed(() => {
  const groups = new Map();
  for (const item of props.items) {
    if (!groups.has(item.type)) groups.set(item.type, []);
    groups.get(item.type).push(item);
  }
  return [...groups].map(([type, items]) => ({ type, items }));
});

function selectedTestId(item, action) {
  return item.id === props.selectedId ? `storage-profile-${action}` : undefined;
}

function profileSnapshot(item) {
  return Object.freeze({
    ...item,
    config: Object.freeze({ ...(item.config || {}) }),
  });
}

function formatTestMessage(result) {
  const statusText = result.connected ? t('sv.tmConnected') : t('sv.tmFailed');
  const statusCode = result.status ? ` (HTTP ${result.status})` : '';
  const detail = result.detail ? ` - ${String(result.detail)}` : '';
  return `${statusText}${statusCode}${detail}`;
}
</script>
