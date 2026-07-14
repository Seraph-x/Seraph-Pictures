<template>
  <section class="card panel storage-panel">
    <div class="panel-head storage-head">
      <div>
        <h2>{{ t('sv.title') }}</h2>
        <p class="muted">{{ t('sv.subtitle') }}</p>
        <p class="muted">{{ t('sv.webdavNote') }}</p>
      </div>
      <button class="btn btn-ghost" @click="resetForm">{{ t('sv.newConfig') }}</button>
    </div>

    <div class="storage-layout">
      <article class="storage-list card-lite">
        <h3>{{ t('sv.configuredBackends') }}</h3>
        <ul v-if="items.length" class="list storage-listing">
          <li v-for="item in items" :key="item.id" class="storage-row">
            <div class="storage-row-main">
              <div class="storage-row-top">
                <strong>{{ item.name }}</strong>
                <span class="badge">{{ getStorageLabel(item.type) }}</span>
                <span class="badge" :class="item.enabled ? 'badge-ok' : 'badge-danger'">
                  {{ item.enabled ? t('sv.enabled') : t('sv.disabled') }}
                </span>
                <span class="badge" v-if="item.isDefault">{{ t('sv.default') }}</span>
              </div>
              <p class="muted">{{ t('sv.idLabel') }}{{ item.id }}</p>
              <p v-if="testResults[item.id]" class="storage-test" :class="testResults[item.id].connected ? 'ok' : 'fail'">
                {{ formatTestMessage(testResults[item.id]) }}
              </p>
            </div>

            <div class="storage-actions">
              <button class="btn btn-ghost" @click="editItem(item)">{{ t('sv.edit') }}</button>
              <button class="btn btn-ghost" @click="testItem(item.id)">{{ t('sv.test') }}</button>
              <button class="btn btn-ghost" @click="toggleEnabled(item)">
                {{ item.enabled ? t('sv.disable') : t('sv.enable') }}
              </button>
              <button class="btn btn-ghost" @click="setDefault(item.id)" :disabled="item.isDefault">{{ t('sv.setDefault') }}</button>
              <button class="btn btn-danger" @click="removeItem(item.id)">{{ t('sv.delete') }}</button>
            </div>
          </li>
        </ul>
        <p v-else class="muted">{{ t('sv.noConfig') }}</p>
      </article>

      <article class="storage-editor card-lite">
        <h3>{{ editingId ? t('sv.editStorage') : t('sv.createStorage') }}</h3>

        <form class="form-grid" @submit.prevent="submit">
          <label>
            {{ t('sv.name') }}
            <input v-model.trim="form.name" required :placeholder="t('sv.namePh')" />
          </label>

          <label>
            {{ t('sv.type') }}
            <select v-model="form.type" @change="onTypeChanged">
              <optgroup :label="t('sv.directGroup')">
                <option v-for="type in directTypes" :key="type.value" :value="type.value">{{ type.label }}</option>
              </optgroup>
              <optgroup :label="t('sv.mountedGroup')">
                <option v-for="type in mountedTypes" :key="type.value" :value="type.value">{{ type.label }}</option>
              </optgroup>
            </select>
          </label>

          <div class="toggle-row">
            <label><input v-model="form.enabled" type="checkbox" /> {{ t('sv.enabledCb') }}</label>
            <label><input v-model="form.isDefault" type="checkbox" /> {{ t('sv.setAsDefault') }}</label>
          </div>

          <div class="field-grid">
            <label v-for="field in currentFields" :key="field.key">
              <span>{{ field.label }}</span>

              <select
                v-if="field.input === 'select'"
                v-model="form.config[field.key]"
                :required="field.required"
              >
                <option
                  v-for="option in field.options || []"
                  :key="`${field.key}-${option.value}`"
                  :value="option.value"
                >
                  {{ option.label }}
                </option>
              </select>

              <textarea
                v-else-if="field.input === 'textarea'"
                v-model="form.config[field.key]"
                :placeholder="field.placeholder"
                :required="field.required"
                rows="4"
              ></textarea>

              <input
                v-else
                v-model.trim="form.config[field.key]"
                :type="field.secret ? 'password' : 'text'"
                :placeholder="field.placeholder"
                :required="field.required"
              />
            </label>
          </div>

          <p v-if="STORAGE_NOTES[form.type]" class="muted">{{ STORAGE_NOTES[form.type] }}</p>

          <div class="form-actions">
            <button class="btn" :disabled="saving">{{ saving ? t('sv.saving') : t('sv.saveConfig') }}</button>
            <button class="btn btn-ghost" type="button" :disabled="testing" @click="testDraftConfig">
              {{ testing ? t('sv.testing') : t('sv.testDraft') }}
            </button>
          </div>
        </form>

        <div v-if="draftTest" class="test-detail" :class="draftTest.connected ? 'ok' : 'fail'">
          <strong>{{ draftTest.connected ? t('sv.draftOk') : t('sv.draftFail') }}</strong>
          <pre>{{ stringifyDetail(draftTest) }}</pre>
        </div>
      </article>
    </div>

    <p v-if="message" class="muted">{{ message }}</p>
    <p v-if="error" class="error">{{ error }}</p>
  </section>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import {
  createStorageConfig,
  deleteStorageConfig,
  listStorageConfigs,
  setDefaultStorageConfig,
  testStorageConfigById,
  testStorageDraft,
  updateStorageConfig,
} from '../api/storage';
import {
  STORAGE_FIELDS,
  STORAGE_NOTES,
  STORAGE_TYPES,
  getStorageFields,
  getStorageLabel,
} from '../config/storage-definitions';
import { useI18n } from '../i18n';

const { t } = useI18n();
const items = ref([]);
const editingId = ref('');
const saving = ref(false);
const testing = ref(false);
const message = ref('');
const error = ref('');
const draftTest = ref(null);
const testResults = reactive({});

const form = reactive({
  name: '',
  type: 'telegram',
  enabled: true,
  isDefault: false,
  config: {},
});

const currentFields = computed(() => getStorageFields(form.type).filter((field) => {
  if (!field.when) return true;
  return Object.entries(field.when).every(([key, value]) => form.config[key] === value);
}));
const directTypes = computed(() => STORAGE_TYPES.filter((item) => item.layer !== 'mounted'));
const mountedTypes = computed(() => STORAGE_TYPES.filter((item) => item.layer === 'mounted'));

onMounted(async () => {
  form.config = buildConfigByType(form.type);
  await loadItems();
});

function buildConfigByType(type, source = {}) {
  const fields = STORAGE_FIELDS[type] || [];
  const target = {};
  for (const field of fields) {
    if (source[field.key] != null) {
      target[field.key] = source[field.key];
      continue;
    }
    if (field.input === 'select') {
      target[field.key] = field.options?.[0]?.value || '';
      continue;
    }
    target[field.key] = '';
  }
  return target;
}

async function loadItems() {
  error.value = '';
  try {
    items.value = await listStorageConfigs();
  } catch (err) {
    error.value = err.message || t('sv.msgLoadFail');
  }
}

function resetForm() {
  editingId.value = '';
  form.name = '';
  form.type = 'telegram';
  form.enabled = true;
  form.isDefault = false;
  form.config = buildConfigByType('telegram');
  draftTest.value = null;
  message.value = '';
  error.value = '';
}

function onTypeChanged() {
  form.config = buildConfigByType(form.type, form.config);
}

function editItem(item) {
  editingId.value = item.id;
  form.name = item.name;
  form.type = item.type;
  form.enabled = Boolean(item.enabled);
  form.isDefault = Boolean(item.isDefault);
  form.config = buildConfigByType(item.type, item.config || {});
  draftTest.value = null;
  message.value = '';
  error.value = '';
}

function buildPayload() {
  return {
    name: form.name,
    type: form.type,
    enabled: Boolean(form.enabled),
    isDefault: Boolean(form.isDefault),
    config: { ...form.config },
  };
}

async function submit() {
  saving.value = true;
  error.value = '';
  message.value = '';

  try {
    const payload = buildPayload();
    if (editingId.value) {
      await updateStorageConfig(editingId.value, payload);
      message.value = t('sv.msgUpdated');
    } else {
      await createStorageConfig(payload);
      const successMessage = t('sv.msgCreated');
      resetForm();
      message.value = successMessage;
    }

    await loadItems();
  } catch (err) {
    error.value = err.message || t('sv.msgSaveFail');
  } finally {
    saving.value = false;
  }
}

async function testDraftConfig() {
  testing.value = true;
  error.value = '';
  message.value = '';

  try {
    const result = await testStorageDraft(form.type, { ...form.config });
    draftTest.value = result || { connected: false };
    message.value = result?.connected ? t('sv.msgDraftOk') : t('sv.msgDraftFail');
  } catch (err) {
    draftTest.value = null;
    error.value = err.message || t('sv.msgConnTestFail');
  } finally {
    testing.value = false;
  }
}

async function testItem(id) {
  error.value = '';
  message.value = '';

  try {
    const result = await testStorageConfigById(id);
    testResults[id] = {
      ...(result || {}),
      testedAt: Date.now(),
    };
    message.value = result?.connected ? t('sv.msgConnOk') : t('sv.msgConnFail');
  } catch (err) {
    error.value = err.message || t('sv.msgTestFail');
  }
}

async function toggleEnabled(item) {
  error.value = '';
  message.value = '';

  try {
    await updateStorageConfig(item.id, {
      enabled: !item.enabled,
    });
    message.value = t('sv.msgStatusUpdated');
    await loadItems();
  } catch (err) {
    error.value = err.message || t('sv.msgUpdateFail');
  }
}

async function setDefault(id) {
  error.value = '';
  message.value = '';

  try {
    await setDefaultStorageConfig(id);
    message.value = t('sv.msgDefaultUpdated');
    await loadItems();
  } catch (err) {
    error.value = err.message || t('sv.msgSetDefaultFail');
  }
}

async function removeItem(id) {
  if (!window.confirm(t('sv.confirmDelete'))) return;

  error.value = '';
  message.value = '';

  try {
    await deleteStorageConfig(id);
    message.value = t('sv.msgDeleted');
    await loadItems();

    if (editingId.value === id) {
      resetForm();
    }
  } catch (err) {
    error.value = err.message || t('sv.msgDeleteFail');
  }
}

function formatTestMessage(result) {
  const statusText = result.connected ? t('sv.tmConnected') : t('sv.tmFailed');
  const statusCode = result.status ? ` (HTTP ${result.status})` : '';
  const detail = result.detail ? ` - ${String(result.detail)}` : '';
  return `${statusText}${statusCode}${detail}`;
}

function stringifyDetail(data) {
  try {
    return JSON.stringify(data, null, 2);
  } catch {
    return String(data || '');
  }
}
</script>
