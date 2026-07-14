import { onRequestDelete as deleteStoredFile } from '../../api/manage/delete/[id].js';
import { getRecordWithKey } from '../file-delivery/common.js';
import {
  FOLDER_PREFIX, isDriveFolderKey, isFileKey, pathWithin,
} from './records.js';

async function deleteFile(context, id) {
  const response = await deleteStoredFile({
    request: new Request(new URL(`/api/manage/delete/${encodeURIComponent(id)}`, context.request.url), {
      method: 'DELETE',
    }),
    env: context.env,
    data: context.data,
    params: { id },
  });
  return response.ok;
}

export async function deleteFileBatch(context, repository, idsValue) {
  const ids = [...new Set((Array.isArray(idsValue) ? idsValue : [])
    .map((id) => String(id || '').trim()).filter(Boolean))];
  if (!ids.length) throw Object.assign(new Error('IDS_REQUIRED'), { code: 'IDS_REQUIRED', status: 400 });
  let deleted = 0;
  const notFound = [];
  const failed = [];
  for (const id of ids) {
    const found = await getRecordWithKey(context.env, id);
    if (!found.record?.metadata) { notFound.push(id); continue; }
    if (await deleteFile(context, found.kvKey)) deleted += 1;
    else failed.push(id);
  }
  return Object.freeze({ requested: ids.length, deleted, notFound, failed });
}

async function containsFolderContent(repository, path) {
  let found = false;
  await repository.scan((key) => {
    const file = isFileKey(key) && pathWithin(key.metadata.folderPath, path);
    const child = isDriveFolderKey(key)
      && key.metadata.folderPath !== path
      && pathWithin(key.metadata.folderPath, path);
    if (!file && !child) return;
    found = true;
    return false;
  });
  return found;
}

export async function deleteFolder(context, repository, path, recursive) {
  if (!recursive && await containsFolderContent(repository, path)) {
    throw Object.assign(new Error('DRIVE_FOLDER_NOT_EMPTY'), {
      code: 'DRIVE_FOLDER_NOT_EMPTY', status: 409,
    });
  }
  let deletedFiles = 0;
  if (recursive) {
    await repository.scan(async (key) => {
      if (!isFileKey(key) || !pathWithin(key.metadata.folderPath, path)) return;
      if (await deleteFile(context, key.name)) deletedFiles += 1;
    });
  }
  let deletedFolders = 0;
  await repository.scan(async (key) => {
    if (!isDriveFolderKey(key) || !pathWithin(key.metadata.folderPath, path)) return;
    await repository.deleteKey(key.name);
    deletedFolders += 1;
  }, FOLDER_PREFIX);
  return Object.freeze({ path, recursive, deletedFiles, deletedFolders });
}
