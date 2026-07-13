import contractModule from '../../../shared/storage/contracts.cjs';

export const FOLDER_PREFIX = 'drive:folder:v1:';
const INVALID_PREFIXES = Object.freeze([
  'session:', 'chunk:', 'upload:', 'temp:', 'drive:', 'storage_', 'storage:',
]);
const { normalizeDriveFile, normalizeDriveFolder, normalizeDrivePath } = contractModule;

export function folderKey(pathValue) {
  return `${FOLDER_PREFIX}${encodeURIComponent(normalizeDrivePath(pathValue))}`;
}

export function folderRecord(pathValue) {
  const folder = normalizeDriveFolder({ path: normalizeDrivePath(pathValue) });
  return Object.freeze({
    key: folderKey(folder.path),
    metadata: Object.freeze({
      folderMarker: true,
      folderPath: folder.path,
      TimeStamp: Date.now(),
    }),
    folder,
  });
}

export function isDriveFolderKey(key) {
  return String(key?.name || '').startsWith(FOLDER_PREFIX)
    && key?.metadata?.folderMarker === true;
}

export function isFileKey(key) {
  const name = String(key?.name || '');
  if (!name || INVALID_PREFIXES.some((prefix) => name.startsWith(prefix))) return false;
  return typeof key?.metadata?.fileName === 'string'
    && key.metadata.TimeStamp !== undefined
    && key.metadata.TimeStamp !== null;
}

export function driveFileFromKey(key) {
  return normalizeDriveFile({ name: key.name, metadata: key.metadata });
}

export function driveFolderFromKey(key) {
  return normalizeDriveFolder({ path: key?.metadata?.folderPath });
}

export function pathWithin(value, parentValue) {
  const path = normalizeDrivePath(value);
  const parent = normalizeDrivePath(parentValue);
  return Boolean(parent) && (path === parent || path.startsWith(`${parent}/`));
}

export function replacePath(value, sourceValue, targetValue) {
  const path = normalizeDrivePath(value);
  const source = normalizeDrivePath(sourceValue);
  const target = normalizeDrivePath(targetValue);
  if (path === source) return target;
  if (!path.startsWith(`${source}/`)) return path;
  return `${target}/${path.slice(source.length + 1)}`;
}

export function fileMatches(file, filters, metadata = {}) {
  if (filters.path !== file.folderPath) return false;
  if (filters.storage !== 'all' && filters.storage !== file.storageType) return false;
  if (filters.visibility !== 'all' && filters.visibility !== file.visibility) return false;
  if (filters.search && !file.fileName.toLowerCase().includes(filters.search)) return false;
  if (filters.listType !== 'all') {
    const listType = String(metadata.ListType || '').toLowerCase();
    if (listType !== filters.listType) return false;
  }
  return true;
}

export { normalizeDrivePath };
