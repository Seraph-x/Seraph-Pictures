<template>
  <section class="card panel">
    <div class="panel-head">
      <h2>File Manager</h2>
      <div class="toolbar">
        <input v-model.trim="search" placeholder="Search file name or id" @keyup.enter="reload" />
        <select v-model="storageFilter" @change="reload">
          <option value="all">All Storage</option>
          <option v-for="type in STORAGE_TYPES" :key="type.value" :value="type.value">{{ type.label }}</option>
        </select>
        <button class="btn" @click="reload">Refresh</button>
      </div>
    </div>

    <div class="stats-grid" v-if="stats">
      <div class="stat-tile"><span>Total</span><strong>{{ stats.total ?? files.length }}</strong></div>
      <div class="stat-tile"><span>Image</span><strong>{{ stats.byType?.image ?? 0 }}</strong></div>
      <div class="stat-tile"><span>Video</span><strong>{{ stats.byType?.video ?? 0 }}</strong></div>
      <div class="stat-tile"><span>Audio</span><strong>{{ stats.byType?.audio ?? 0 }}</strong></div>
    </div>

    <div class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th>Preview</th>
            <th>Name</th>
            <th>Storage</th>
            <th>Size</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in files" :key="item.name">
            <td>
              <a :href="fileLink(item.name)" target="_blank" rel="noopener" class="preview-cell">
                <img v-if="isImage(item.name)" :src="fileLink(item.name)" :alt="displayName(item)" @error="onImageError" />
                <span v-else>FILE</span>
              </a>
            </td>
            <td>
              <div class="file-col">
                <strong>{{ displayName(item) }}</strong>
                <small>{{ item.name }}</small>
                <small>{{ formatTime(item.metadata?.TimeStamp) }}</small>
              </div>
            </td>
            <td>
              <span class="badge">{{ item.metadata?.storageType || 'telegram' }}</span>
            </td>
            <td>{{ formatSize(item.metadata?.fileSize || 0) }}</td>
            <td>
              <span class="badge" :class="statusClass(item.metadata?.ListType)">{{ item.metadata?.ListType || 'None' }}</span>
            </td>
            <td>
              <div class="table-actions">
                <button class="btn btn-ghost" @click="copyLink(item.name)">Copy</button>
                <button class="btn btn-ghost" @click="toggleLike(item)">{{ item.metadata?.liked ? 'Unstar' : 'Star' }}</button>
                <button class="btn btn-ghost" @click="setWhite(item.name)">White</button>
                <button class="btn btn-ghost" @click="setBlock(item.name)">Block</button>
                <button class="btn btn-danger" @click="remove(item.name)">Delete</button>
              </div>
            </td>
          </tr>
          <tr v-if="!loading && files.length === 0">
            <td colspan="6" class="empty">No files found.</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="footer-actions">
      <button v-if="nextCursor" class="btn" :disabled="loading" @click="loadMore">
        {{ loading ? 'Loading...' : 'Load More' }}
      </button>
    </div>

    <p v-if="error" class="error">{{ error }}</p>
  </section>
</template>

<script setup>
import { onMounted, ref } from 'vue';
import { apiFetch, absoluteFileUrl } from '../api/client';
import { STORAGE_TYPES } from '../config/storage-definitions';

const files = ref([]);
const nextCursor = ref(null);
const loading = ref(false);
const error = ref('');
const stats = ref(null);
const search = ref('');
const storageFilter = ref('all');

onMounted(async () => {
  await reload();
});

async function reload() {
  files.value = [];
  nextCursor.value = null;
  stats.value = null;
  await fetchList(true);
}

async function loadMore() {
  await fetchList(false);
}

async function fetchList(reset) {
  if (loading.value) return;
  loading.value = true;
  error.value = '';

  try {
    const params = new URLSearchParams();
    params.set('limit', '100');
    if (storageFilter.value !== 'all') params.set('storage', storageFilter.value);
    if (search.value) params.set('search', search.value);
    if (!reset && nextCursor.value) params.set('cursor', nextCursor.value);
    if (reset) params.set('includeStats', '1');

    const data = await apiFetch(`/api/manage/list?${params.toString()}`);
    const incoming = Array.isArray(data.keys) ? data.keys : [];

    if (reset) {
      files.value = incoming;
      stats.value = data.stats || null;
    } else {
      const seen = new Set(files.value.map((x) => x.name));
      for (const item of incoming) {
        if (!seen.has(item.name)) files.value.push(item);
      }
    }

    nextCursor.value = data.list_complete ? null : data.cursor;
  } catch (err) {
    error.value = err.message || 'Failed to load files';
  } finally {
    loading.value = false;
  }
}

function fileLink(id) {
  return absoluteFileUrl(id);
}

function displayName(item) {
  return item.metadata?.fileName || item.name;
}

function isImage(name = '') {
  const ext = String(name).split('.').pop()?.toLowerCase() || '';
  return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'ico', 'avif', 'heic'].includes(ext);
}

function formatSize(bytes = 0) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  return `${value.toFixed(idx === 0 ? 0 : 2)} ${units[idx]}`;
}

function formatTime(timestamp) {
  if (!timestamp) return '-';
  try {
    return new Date(Number(timestamp)).toLocaleString();
  } catch {
    return '-';
  }
}

function statusClass(value = 'None') {
  const normalized = String(value).toLowerCase();
  if (normalized === 'block') return 'badge-danger';
  if (normalized === 'white') return 'badge-ok';
  return '';
}

function onImageError(event) {
  const target = event.target;
  if (target) target.style.display = 'none';
}

async function copyLink(id) {
  const link = fileLink(id);
  try {
    await navigator.clipboard.writeText(link);
  } catch {
    const input = document.createElement('textarea');
    input.value = link;
    document.body.appendChild(input);
    input.select();
    document.execCommand('copy');
    document.body.removeChild(input);
  }
}

async function toggleLike(item) {
  try {
    const data = await apiFetch(`/api/manage/toggleLike/${encodeURIComponent(item.name)}`, {
      method: 'POST',
    });
    item.metadata = {
      ...(item.metadata || {}),
      liked: Boolean(data.liked),
    };
  } catch (err) {
    error.value = err.message;
  }
}

async function setBlock(name) {
  try {
    const data = await apiFetch(`/api/manage/block/${encodeURIComponent(name)}`, {
      method: 'POST',
    });
    updateListType(name, data.listType || 'Block');
  } catch (err) {
    error.value = err.message;
  }
}

async function setWhite(name) {
  try {
    const data = await apiFetch(`/api/manage/white/${encodeURIComponent(name)}`, {
      method: 'POST',
    });
    updateListType(name, data.listType || 'White');
  } catch (err) {
    error.value = err.message;
  }
}

function updateListType(name, listType) {
  const target = files.value.find((x) => x.name === name);
  if (!target) return;
  target.metadata = {
    ...(target.metadata || {}),
    ListType: listType,
  };
}

async function remove(name) {
  if (!window.confirm(`Delete ${name}?`)) return;

  try {
    await apiFetch(`/api/manage/delete/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    });
    files.value = files.value.filter((x) => x.name !== name);
  } catch (err) {
    error.value = err.message;
  }
}
</script>
