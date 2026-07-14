import { apiFetch } from './client';

export async function listStorageConfigs() {
  const data = await apiFetch('/api/storage/list');
  return data.items || [];
}

export const listStorageProfiles = listStorageConfigs;

export async function createStorageConfig(payload) {
  const data = await apiFetch('/api/storage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return data.item;
}

export async function updateStorageConfig(id, payload) {
  const data = await apiFetch(`/api/storage/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return data.item;
}

export async function deleteStorageConfig(id) {
  return apiFetch(`/api/storage/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export async function setDefaultStorageConfig(id) {
  const data = await apiFetch(`/api/storage/default/${encodeURIComponent(id)}`, {
    method: 'POST',
  });
  return data.item;
}

export async function testStorageConfigById(id) {
  const data = await apiFetch(`/api/storage/${encodeURIComponent(id)}/test`, {
    method: 'POST',
  });
  return data.result;
}

export async function testStorageDraft(type, config) {
  const data = await apiFetch('/api/storage/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, config }),
  });
  return data.result;
}
