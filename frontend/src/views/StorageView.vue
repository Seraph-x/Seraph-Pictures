<template>
  <section class="card panel storage-panel">
    <div class="panel-head storage-head">
      <div>
        <h2>{{ t('sv.title') }}</h2>
        <p class="muted">{{ t('sv.subtitle') }}</p>
        <p class="muted">{{ t('sv.webdavNote') }}</p>
      </div>
      <button class="btn btn-ghost" @click="startCreate">{{ t('sv.newConfig') }}</button>
    </div>

    <div class="storage-layout">
      <StorageProfileList
        :items="items"
        :selected-id="selectedId"
        :test-results="testResults"
        @default="makeDefault"
        @delete="removeProfile"
        @edit="openEditor"
        @select="selectProfile"
        @test="testProfile"
        @toggle="toggleProfile"
      />
      <StorageProfileEditor
        :key="editorRevision"
        :draft-test="draftTest"
        :item="editingItem"
        :profiles="items"
        :revision="editorRevision"
        :saving="saving"
        :testing="testing"
        @save="saveProfile"
        @test="testDraft"
      />
    </div>

    <p v-if="message" class="muted">{{ message }}</p>
    <p v-if="error" class="error">{{ error }}</p>
  </section>
</template>

<script setup>
import { onMounted } from 'vue';
import * as storageApi from '../api/storage';
import StorageProfileEditor from '../components/storage/StorageProfileEditor.vue';
import StorageProfileList from '../components/storage/StorageProfileList.vue';
import { useStorageProfileEditor } from '../composables/storage/useStorageProfileEditor';
import { useI18n } from '../i18n';

const { t } = useI18n();
const editor = useStorageProfileEditor({
  api: storageApi,
  t,
  confirmDelete: (message) => window.confirm(message),
});
const {
  draftTest, editingItem, editorRevision, error, items, message, saving,
  selectedId, testing, testResults, makeDefault, openEditor, refresh,
  removeProfile, saveProfile, selectProfile, startCreate, testDraft,
  testProfile, toggleProfile,
} = editor;

onMounted(refresh);
</script>
