'use strict';

const { normalizeNextCursor } = require('./pagination.cjs');
const { resolveCapability } = require('./capabilities.cjs');

const ADMIN_AUTH = 'admin';
const MASKED_SECRET = '********';
const VISIBILITIES = Object.freeze(new Set(['public', 'private']));
const STORAGE_SECRET_FIELDS = Object.freeze({
  telegram: Object.freeze(['botToken']),
  r2: Object.freeze(['accessKeyId', 'secretAccessKey']),
  s3: Object.freeze(['accessKeyId', 'secretAccessKey']),
  discord: Object.freeze(['botToken', 'webhookUrl']),
  huggingface: Object.freeze(['token']),
  webdav: Object.freeze(['password', 'bearerToken', 'token']),
  github: Object.freeze(['token']),
});

class ApiContractError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

function descriptor(method, path, envelope) {
  return Object.freeze({ method, path, auth: ADMIN_AUTH, envelope });
}

const STORAGE_OPERATIONS = Object.freeze({
  list: descriptor('GET', '/api/storage/list', 'items'),
  create: descriptor('POST', '/api/storage', 'item'),
  delete: descriptor('DELETE', '/api/storage/:id', 'success'),
  update: descriptor('PUT', '/api/storage/:id', 'item'),
  setDefault: descriptor('POST', '/api/storage/default/:id', 'item'),
  testById: descriptor('POST', '/api/storage/:id/test', 'result'),
  testDraft: descriptor('POST', '/api/storage/test', 'result'),
});

const DRIVE_OPERATIONS = Object.freeze({
  tree: descriptor('GET', '/api/drive/tree', 'nodes'),
  explorer: descriptor('GET', '/api/drive/explorer', 'explorer'),
  createFolder: descriptor('POST', '/api/drive/folders', 'folder'),
  moveFolder: descriptor('POST', '/api/drive/folders/move', 'mutation'),
  deleteFolder: descriptor('DELETE', '/api/drive/folders', 'mutation'),
  moveFiles: descriptor('POST', '/api/drive/files/move', 'mutation'),
  renameFile: descriptor('POST', '/api/drive/files/rename', 'file'),
  deleteFiles: descriptor('POST', '/api/drive/files/delete-batch', 'mutation'),
  signShare: descriptor('POST', '/api/share/sign', 'share'),
});

function operationFrom(definitions, name, options = {}) {
  const operation = definitions[name];
  if (!operation) throw new ApiContractError('API_OPERATION_UNSUPPORTED');
  if (!operation.path.includes(':id')) return operation;
  const id = String(options.id || '').trim();
  if (!id) throw new ApiContractError('STORAGE_ID_REQUIRED');
  return descriptor(operation.method, operation.path.replace(':id', encodeURIComponent(id)), operation.envelope);
}

function storageOperation(name, options) {
  return operationFrom(STORAGE_OPERATIONS, name, options);
}

function driveOperation(name) {
  return operationFrom(DRIVE_OPERATIONS, name);
}

function parseObject(value, errorCode) {
  if (value == null || value === '') return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch {
    throw new ApiContractError(errorCode, 500);
  }
  throw new ApiContractError(errorCode, 500);
}

function requiredString(value, code) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new ApiContractError(code);
  return normalized;
}

function validateStorageType(value) {
  const type = requiredString(value, 'STORAGE_TYPE_REQUIRED').toLowerCase();
  resolveCapability({ runtime: 'cloudflare', type });
  return type;
}

function maskStorageConfig(typeValue, configValue) {
  const type = validateStorageType(typeValue);
  const config = { ...parseObject(configValue, 'STORAGE_CONFIG_INVALID') };
  for (const field of STORAGE_SECRET_FIELDS[type]) {
    if (config[field]) config[field] = MASKED_SECRET;
  }
  return Object.freeze(config);
}

function mergeStorageConfig(typeValue, currentValue, patchValue) {
  const type = validateStorageType(typeValue);
  const current = { ...parseObject(currentValue, 'STORAGE_CONFIG_INVALID') };
  const patch = { ...parseObject(patchValue, 'STORAGE_CONFIG_INVALID') };
  for (const field of STORAGE_SECRET_FIELDS[type]) {
    if (patch[field] === '' || patch[field] === MASKED_SECRET) delete patch[field];
  }
  return Object.freeze({ ...current, ...patch });
}

function normalizeStorageItem(record) {
  const id = requiredString(record?.id, 'STORAGE_ID_REQUIRED');
  const type = validateStorageType(record?.type);
  const config = maskStorageConfig(type, record.config);
  const metadataSource = record.metadata ?? record.metadata_json;
  const metadata = Object.freeze({ ...parseObject(metadataSource, 'STORAGE_METADATA_INVALID') });
  return Object.freeze({
    id,
    name: requiredString(record.name, 'STORAGE_NAME_REQUIRED'),
    type,
    enabled: Boolean(record.enabled),
    isDefault: Boolean(record.isDefault ?? record.is_default),
    config,
    metadata,
    createdAt: record.createdAt ?? record.created_at ?? null,
    updatedAt: record.updatedAt ?? record.updated_at ?? null,
  });
}

function normalizeConnectionResult(value = {}) {
  return Object.freeze({ ...value, connected: Boolean(value.connected) });
}

function storageEnvelope(kind, payload) {
  if (kind === 'success') return Object.freeze({ success: true });
  if (kind === 'items') {
    const items = Object.freeze((Array.isArray(payload) ? payload : []).map(normalizeStorageItem));
    return Object.freeze({ success: true, items });
  }
  if (kind === 'item') return Object.freeze({ success: true, item: normalizeStorageItem(payload) });
  if (kind === 'result') return Object.freeze({ success: true, result: normalizeConnectionResult(payload) });
  throw new ApiContractError('API_ENVELOPE_UNSUPPORTED', 500);
}

function normalizeDrivePath(value) {
  const raw = String(value || '').trim().replace(/\\/g, '/');
  if (!raw) return '';
  if (/[\u0000-\u001f\u007f]/.test(raw)) throw new ApiContractError('DRIVE_PATH_INVALID');
  const segments = raw.split('/').filter(Boolean).map((segment) => segment.trim());
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new ApiContractError('DRIVE_PATH_INVALID');
  }
  return segments.join('/');
}

function normalizeDriveFolder(record = {}) {
  const path = normalizeDrivePath(record.path);
  const segments = path ? path.split('/') : [];
  return Object.freeze({
    path,
    name: String(record.name || segments.at(-1) || 'All Files'),
    parentPath: normalizeDrivePath(record.parentPath ?? segments.slice(0, -1).join('/')),
  });
}

function normalizedNumber(value, fallback) {
  if (value == null || value === '') return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeVisibility(value) {
  const visibility = String(value || '');
  if (!VISIBILITIES.has(visibility)) throw new ApiContractError('FILE_VISIBILITY_INVALID');
  return visibility;
}

function normalizeDriveFile(record = {}) {
  const metadata = record.metadata && typeof record.metadata === 'object' ? record.metadata : record;
  const id = requiredString(record.id ?? record.name, 'FILE_ID_REQUIRED');
  return Object.freeze({
    id,
    fileName: requiredString(metadata.fileName ?? metadata.file_name, 'FILE_NAME_REQUIRED'),
    fileSize: normalizedNumber(metadata.fileSize ?? metadata.file_size, 0),
    mimeType: String(metadata.mimeType ?? metadata.mime_type ?? ''),
    storageType: String(metadata.storageType ?? metadata.storage_type ?? ''),
    folderPath: normalizeDrivePath(metadata.folderPath ?? metadata.folder_path),
    visibility: normalizeVisibility(metadata.visibility),
    createdAt: normalizedNumber(metadata.createdAt ?? metadata.created_at ?? metadata.TimeStamp, null),
  });
}

function explorerEnvelope(payload = {}) {
  return Object.freeze({
    success: true,
    folders: Object.freeze((payload.folders || []).map(normalizeDriveFolder)),
    files: Object.freeze((payload.files || payload.items || []).map(normalizeDriveFile)),
    nextCursor: normalizeNextCursor(payload.nextCursor),
    stats: Object.freeze({ ...(payload.stats || {}) }),
  });
}

function driveEnvelope(kind, payload = {}) {
  if (kind === 'explorer') return explorerEnvelope(payload);
  if (kind === 'nodes') {
    return Object.freeze({ success: true, nodes: Object.freeze((payload || []).map(normalizeDriveFolder)) });
  }
  if (kind === 'folder') return Object.freeze({ success: true, folder: normalizeDriveFolder(payload) });
  if (kind === 'file') return Object.freeze({ success: true, file: normalizeDriveFile(payload) });
  if (kind === 'mutation' || kind === 'share') return Object.freeze({ ...payload, success: true });
  throw new ApiContractError('API_ENVELOPE_UNSUPPORTED', 500);
}

module.exports = Object.freeze({
  ApiContractError,
  STORAGE_OPERATIONS,
  DRIVE_OPERATIONS,
  storageOperation,
  driveOperation,
  maskStorageConfig,
  mergeStorageConfig,
  normalizeStorageItem,
  normalizeDrivePath,
  normalizeDriveFolder,
  normalizeDriveFile,
  storageEnvelope,
  driveEnvelope,
});
