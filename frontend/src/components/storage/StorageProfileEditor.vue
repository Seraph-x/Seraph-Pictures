<template>
  <article class="storage-editor card-lite">
    <h3>{{ item ? t('sv.editStorage') : t('sv.createStorage') }}</h3>

    <form class="form-grid" @submit.prevent="submit">
      <label>
        {{ t('sv.name') }}
        <input v-model.trim="form.name" required :placeholder="t('sv.namePh')" />
      </label>

      <label>
        {{ t('sv.type') }}
        <select v-model="form.type" :disabled="Boolean(item?.isDefault)" @change="changeType">
          <optgroup :label="t('sv.directGroup')">
            <option v-for="type in directTypes" :key="type.value" :value="type.value">
              {{ type.label }}
            </option>
          </optgroup>
          <optgroup :label="t('sv.mountedGroup')">
            <option v-for="type in mountedTypes" :key="type.value" :value="type.value">
              {{ type.label }}
            </option>
          </optgroup>
        </select>
      </label>

      <div class="toggle-row">
        <label>
          <input
            v-model="form.enabled"
            data-testid="storage-profile-enabled"
            type="checkbox"
            :disabled="enabledLocked"
          /> {{ t('sv.enabledCb') }}
        </label>
        <label>
          <input
            v-model="form.isDefault"
            data-testid="storage-profile-default-checkbox"
            type="checkbox"
            :disabled="defaultLocked"
          /> {{ t('sv.setAsDefault') }}
        </label>
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
            >{{ option.label }}</option>
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
        <button class="btn" :disabled="saving">
          {{ saving ? t('sv.saving') : t('sv.saveConfig') }}
        </button>
        <button class="btn btn-ghost" type="button" :disabled="testing" @click="testDraft">
          {{ testing ? t('sv.testing') : t('sv.testDraft') }}
        </button>
      </div>
    </form>

    <div v-if="draftTest" class="test-detail" :class="draftTest.connected ? 'ok' : 'fail'">
      <strong>{{ draftTest.connected ? t('sv.draftOk') : t('sv.draftFail') }}</strong>
      <pre>{{ stringifyDetail(draftTest) }}</pre>
    </div>
  </article>
</template>

<script setup>
import { computed, reactive, watch } from 'vue';
import {
  STORAGE_FIELDS,
  STORAGE_NOTES,
  STORAGE_TYPES,
  getStorageFields,
} from '../../config/storage-definitions';
import { useI18n } from '../../i18n';

const props = defineProps({
  draftTest: { type: Object, default: null },
  item: { type: Object, default: null },
  profiles: { type: Array, required: true },
  revision: { type: Number, required: true },
  saving: { type: Boolean, required: true },
  testing: { type: Boolean, required: true },
});
const emit = defineEmits(['save', 'test']);
const { t } = useI18n();
const form = reactive(emptyForm());
const directTypes = STORAGE_TYPES.filter((item) => item.layer !== 'mounted');
const mountedTypes = STORAGE_TYPES.filter((item) => item.layer === 'mounted');
const currentFields = computed(() => getStorageFields(form.type).filter(fieldVisible));
const firstOfType = computed(() => !props.profiles.some((profile) => (
  profile.type === form.type && profile.id !== props.item?.id
)));
const defaultLocked = computed(() => Boolean(props.item?.isDefault) || firstOfType.value);
const enabledLocked = computed(() => defaultLocked.value || form.isDefault);

watch([() => props.revision, () => props.profiles], resetForm, { immediate: true });
watch(() => form.isDefault, ensureDefaultEnabled);

function emptyForm() {
  return {
    name: '', type: 'telegram', enabled: true, isDefault: false,
    config: buildConfigByType('telegram'),
  };
}

function buildConfigByType(type, source = {}) {
  return Object.fromEntries((STORAGE_FIELDS[type] || []).map((field) => {
    if (source[field.key] != null) return [field.key, source[field.key]];
    const initial = field.input === 'select' ? field.options?.[0]?.value || '' : '';
    return [field.key, initial];
  }));
}

function resetForm() {
  const source = props.item || emptyForm();
  form.name = source.name;
  form.type = source.type;
  form.enabled = firstOfType.value ? true : Boolean(source.enabled);
  form.isDefault = firstOfType.value || Boolean(source.isDefault);
  form.config = buildConfigByType(source.type, source.config);
}

function fieldVisible(field) {
  if (!field.when) return true;
  return Object.entries(field.when).every(([key, value]) => form.config[key] === value);
}

function changeType() {
  form.config = buildConfigByType(form.type, form.config);
  form.enabled = firstOfType.value ? true : form.enabled;
  form.isDefault = firstOfType.value;
}

function ensureDefaultEnabled(isDefault) {
  if (isDefault) form.enabled = true;
}

function buildPayload() {
  return Object.freeze({
    name: form.name,
    type: form.type,
    enabled: Boolean(form.enabled),
    isDefault: Boolean(form.isDefault),
    config: Object.freeze({ ...form.config }),
  });
}

function submit() {
  emit('save', buildPayload());
}

function testDraft() {
  const payload = buildPayload();
  emit('test', Object.freeze({ type: payload.type, config: payload.config }));
}

function stringifyDetail(data) {
  return JSON.stringify(data, null, 2);
}
</script>
