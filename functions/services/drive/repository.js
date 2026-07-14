import paginationModule from '../../../shared/storage/pagination.cjs';
import { getRecordWithKey } from '../file-delivery/common.js';
import { createStorageProfileRepository } from '../storage-profiles/repository.js';
import {
  FOLDER_PREFIX, driveFileFromKey, driveFolderFromKey, fileMatches,
  folderRecord, isDriveFolderKey, isFileKey, normalizeDrivePath,
  pathWithin, replacePath,
} from './records.js';

const SCAN_PAGE_SIZE = 1000;
const { normalizeNextCursor } = paginationModule;

function bindingFrom(env) {
  if (!env?.img_url?.list || !env.img_url?.put || !env.img_url?.delete) {
    throw Object.assign(new Error('KV_BINDING_MISSING'), { code: 'KV_BINDING_MISSING', status: 500 });
  }
  return env.img_url;
}

async function scan(binding, visitor, prefix) {
  let cursor;
  do {
    const page = await binding.list({ limit: SCAN_PAGE_SIZE, cursor, prefix });
    for (const key of page.keys || []) {
      if (await visitor(key) === false) return false;
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return true;
}

async function updateMetadata(binding, key, metadata) {
  const current = await binding.getWithMetadata(key);
  if (!current?.metadata) return false;
  await binding.put(key, current.value || '', { metadata: Object.freeze(metadata) });
  return true;
}

async function createFolder(binding, pathValue) {
  const path = normalizeDrivePath(pathValue);
  if (!path) throw Object.assign(new Error('DRIVE_PATH_REQUIRED'), { code: 'DRIVE_PATH_REQUIRED', status: 400 });
  const segments = path.split('/');
  for (let index = 1; index <= segments.length; index += 1) {
    const record = folderRecord(segments.slice(0, index).join('/'));
    await binding.put(record.key, '', { metadata: record.metadata });
  }
  return folderRecord(path).folder;
}

async function listFolderPage(binding, pageRequest) {
  const page = await binding.list({
    prefix: FOLDER_PREFIX, limit: pageRequest.limit, cursor: pageRequest.cursor || undefined,
  });
  return Object.freeze({
    nodes: Object.freeze((page.keys || []).filter(isDriveFolderKey).map(driveFolderFromKey)),
    nextCursor: page.list_complete ? null : normalizeNextCursor(page.cursor),
  });
}

async function listExplorerPage(binding, options, snapshot) {
  const folderPrefix = `${FOLDER_PREFIX}${encodeURIComponent(
    options.filters.path ? `${options.filters.path}/` : '',
  )}`;
  const [page, folderPage] = await Promise.all([
    binding.list({ limit: options.limit, cursor: options.cursor || undefined }),
    binding.list({ limit: options.limit, prefix: folderPrefix }),
  ]);
  const files = (page.keys || []).filter(isFileKey)
    .map((key) => Object.freeze({ key, file: driveFileFromKey(key, snapshot) }))
    .filter(({ key, file }) => fileMatches(file, options.filters, key.metadata))
    .map(({ file }) => file);
  const folders = (folderPage.keys || []).filter(isDriveFolderKey)
    .map(driveFolderFromKey)
    .filter((folder) => folder.parentPath === options.filters.path);
  return Object.freeze({
    currentPath: options.filters.path,
    folders: Object.freeze(folders),
    files: Object.freeze(files),
    nextCursor: page.list_complete ? null : normalizeNextCursor(page.cursor),
    folderCursor: folderPage.list_complete ? null : normalizeNextCursor(folderPage.cursor),
    stats: Object.freeze(options.includeStats ? { files: files.length } : {}),
  });
}

async function moveFiles(binding, ids, targetPathValue) {
  const targetFolderPath = normalizeDrivePath(targetPathValue);
  const uniqueIds = [...new Set(ids.map((id) => String(id || '').trim()).filter(Boolean))];
  if (!uniqueIds.length) throw Object.assign(new Error('IDS_REQUIRED'), { code: 'IDS_REQUIRED', status: 400 });
  let moved = 0;
  const notFound = [];
  for (const id of uniqueIds) {
    const found = await getRecordWithKey({ img_url: binding }, id);
    if (!found.record?.metadata) { notFound.push(id); continue; }
    const metadata = { ...found.record.metadata, folderPath: targetFolderPath };
    await binding.put(found.kvKey, found.record.value || '', { metadata });
    moved += 1;
  }
  return Object.freeze({ requested: uniqueIds.length, moved, notFound, targetFolderPath });
}

async function renameFile(options) {
  const { binding, idValue, fileNameValue, snapshot } = options;
  const id = String(idValue || '').trim();
  const fileName = String(fileNameValue || '').trim();
  if (!id || !fileName) throw Object.assign(new Error('FILE_RENAME_PARAMS_REQUIRED'), {
    code: 'FILE_RENAME_PARAMS_REQUIRED', status: 400,
  });
  const found = await getRecordWithKey({ img_url: binding }, id);
  if (!found.record?.metadata) return null;
  const metadata = Object.freeze({ ...found.record.metadata, fileName });
  await binding.put(found.kvKey, found.record.value || '', { metadata });
  return driveFileFromKey({ name: found.kvKey, metadata }, snapshot);
}

async function moveFolder(binding, sourceValue, targetValue) {
  const sourcePath = normalizeDrivePath(sourceValue);
  const targetPath = normalizeDrivePath(targetValue);
  if (!sourcePath || !targetPath) throw Object.assign(new Error('MOVE_PATHS_REQUIRED'), {
    code: 'MOVE_PATHS_REQUIRED', status: 400,
  });
  if (sourcePath === targetPath || pathWithin(targetPath, sourcePath)) {
    throw Object.assign(new Error('DRIVE_MOVE_INVALID'), { code: 'DRIVE_MOVE_INVALID', status: 400 });
  }
  let updatedFiles = 0;
  await scan(binding, async (key) => {
    if (!isFileKey(key) || !pathWithin(key.metadata.folderPath, sourcePath)) return;
    const metadata = { ...key.metadata, folderPath: replacePath(key.metadata.folderPath, sourcePath, targetPath) };
    if (await updateMetadata(binding, key.name, metadata)) updatedFiles += 1;
  });
  let updatedFolders = 0;
  await scan(binding, async (key) => {
    if (!isDriveFolderKey(key) || !pathWithin(key.metadata.folderPath, sourcePath)) return;
    const next = folderRecord(replacePath(key.metadata.folderPath, sourcePath, targetPath));
    await binding.put(next.key, '', { metadata: next.metadata });
    await binding.delete(key.name);
    updatedFolders += 1;
  }, FOLDER_PREFIX);
  await createFolder(binding, targetPath);
  return Object.freeze({ sourcePath, targetPath, updatedFiles, updatedFolders });
}

export function createDriveRepository(env, dependencies = {}) {
  const binding = bindingFrom(env);
  const profileRepository = dependencies.profileRepository || createStorageProfileRepository(env);
  const snapshot = () => dependencies.profileSnapshot || profileRepository.runtimeSnapshot();
  return Object.freeze({
    listFolderPage: (pageRequest) => listFolderPage(binding, pageRequest),
    listExplorerPage: async (options) => listExplorerPage(binding, options, await snapshot()),
    createFolder: (path) => createFolder(binding, path),
    moveFolder: (source, target) => moveFolder(binding, source, target),
    moveFiles: (ids, target) => moveFiles(binding, ids, target),
    renameFile: async (id, name) => renameFile({
      binding, idValue: id, fileNameValue: name, snapshot: await snapshot(),
    }),
    scan: (visitor, prefix) => scan(binding, visitor, prefix),
    deleteKey: (key) => binding.delete(key),
  });
}
