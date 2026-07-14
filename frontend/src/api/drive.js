import { apiFetch } from './client.js';
import {
  buildDriveExplorerPath,
  buildDriveTreePath,
  buildMigrationPayload,
} from '../utils/drive-profile-contract.js';

export async function getDriveTree(options = 'all') {
  const data = await apiFetch(buildDriveTreePath(options));
  return data.nodes || [];
}

export async function getDriveExplorer({
  path = '',
  storage = 'all',
  storageId = '',
  search = '',
  listType = 'all',
  limit = 100,
  cursor = '',
  includeStats = true,
} = {}) {
  return apiFetch(buildDriveExplorerPath({
    path, storage, storageId, search, listType, limit, cursor, includeStats,
  }));
}

export async function migrateFiles(ids, destinationStorageId) {
  return apiFetch('/api/drive/files/migrate', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildMigrationPayload({ ids, destinationStorageId })),
  });
}

export async function createFolder(path) {
  return apiFetch('/api/drive/folders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  });
}

export async function moveFolder(sourcePath, targetPath) {
  return apiFetch('/api/drive/folders/move', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sourcePath, targetPath }),
  });
}

export async function deleteFolder(path, recursive = false) {
  const query = new URLSearchParams({ path });
  if (recursive) query.set('recursive', '1');
  return apiFetch(`/api/drive/folders?${query.toString()}`, {
    method: 'DELETE',
  });
}

export async function moveFiles(ids, targetFolderPath) {
  return apiFetch('/api/drive/files/move', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids, targetFolderPath }),
  });
}

export async function renameFile(id, fileName) {
  return apiFetch('/api/drive/files/rename', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, fileName }),
  });
}

export async function deleteFiles(ids) {
  return apiFetch('/api/drive/files/delete-batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
}

export async function signShareLink(fileId, ttlSeconds = 7 * 24 * 60 * 60) {
  return apiFetch('/api/share/sign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileId, ttlSeconds }),
  });
}
