const { all, get } = require('../../db');
const { normalizeFolderPath } = require('./file-repo');

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;
const STORAGE_TYPES = Object.freeze([
  'telegram', 'r2', 's3', 'discord', 'huggingface', 'webdav', 'github',
]);

function parseExtra(value) {
  try {
    return JSON.parse(value || '{}');
  } catch {
    return {};
  }
}

function pageValues(options) {
  return Object.freeze({
    limit: Math.max(1, Math.min(MAX_LIMIT, Number(options.limit) || DEFAULT_LIMIT)),
    offset: Math.max(0, Number(options.cursor) || 0),
  });
}

function fileWhere(options) {
  const filters = options.filters || {};
  const clauses = ['folder_path = ?'];
  const params = [normalizeFolderPath(options.folderPath)];
  if (filters.search) {
    clauses.push('(LOWER(file_name) LIKE ? OR LOWER(id) LIKE ?)');
    const term = `%${String(filters.search).toLowerCase()}%`;
    params.push(term, term);
  }
  for (const [field, value] of [
    ['storage_type', filters.storageType], ['list_type', filters.listType],
    ['visibility', filters.visibility],
  ]) {
    if (value && value !== 'all') {
      clauses.push(`${field} = ?`);
      params.push(String(value));
    }
  }
  return Object.freeze({ sql: `WHERE ${clauses.join(' AND ')}`, params });
}

function fileMetadata(row) {
  return Object.freeze({
    TimeStamp: row.created_at,
    ListType: row.list_type || 'None',
    Label: row.label || 'None',
    liked: Boolean(row.liked),
    fileName: row.file_name,
    fileSize: row.file_size || 0,
    storageType: row.storage_type,
    mimeType: row.mime_type || '',
    folderPath: normalizeFolderPath(row.folder_path),
    visibility: row.visibility,
    uploadSource: row.upload_source,
    accessVersion: row.access_version,
    expiresAt: row.expires_at,
    ...parseExtra(row.extra_json),
  });
}

function mapFile(row) {
  return Object.freeze({ name: row.id, metadata: fileMetadata(row) });
}

function folderName(path) {
  return path ? path.split('/').at(-1) : 'All Files';
}

function folderParent(path) {
  if (!path) return '';
  return path.split('/').slice(0, -1).join('/');
}

function breadcrumbs(path) {
  const output = [{ path: '', name: 'All Files' }];
  if (!path) return output;
  const parts = path.split('/');
  parts.forEach((name, index) => output.push({
    path: parts.slice(0, index + 1).join('/'), name,
  }));
  return output;
}

function directFolderQuery(parentPath) {
  if (!parentPath) {
    return Object.freeze({ sql: "WHERE instr(path, '/') = 0", params: [] });
  }
  const prefix = `${parentPath}/`;
  return Object.freeze({
    sql: "WHERE path LIKE ? AND instr(substr(path, ?), '/') = 0",
    params: [`${prefix}%`, prefix.length + 1],
  });
}

function fileTypeFromMime(mimeType) {
  const prefix = String(mimeType || '').split('/')[0];
  return ['image', 'video', 'audio'].includes(prefix) ? prefix : 'document';
}

class DriveQueryRepository {
  constructor(db) {
    this.db = db;
  }

  listExplorer(options = {}) {
    const path = normalizeFolderPath(options.folderPath);
    const page = pageValues(options);
    const where = fileWhere({ ...options, folderPath: path });
    const rows = all(this.db, `SELECT * FROM files ${where.sql}
      ORDER BY created_at DESC LIMIT ? OFFSET ?`, [...where.params, page.limit, page.offset]);
    const total = Number(get(this.db, `SELECT COUNT(1) AS c FROM files ${where.sql}`, where.params)?.c || 0);
    const nextOffset = page.offset + rows.length;
    return Object.freeze({
      currentPath: path,
      breadcrumbs: breadcrumbs(path),
      folders: this.listChildFolders(path, options.filters),
      files: rows.map(mapFile),
      cursor: nextOffset >= total ? null : String(nextOffset),
      list_complete: nextOffset >= total,
      pageCount: rows.length,
      stats: options.includeStats ? this.stats(options.filters) : undefined,
    });
  }

  listChildFolders(parentPath, filters = {}) {
    const query = directFolderQuery(parentPath);
    const rows = all(this.db, `SELECT path FROM virtual_folders ${query.sql} ORDER BY path`, query.params);
    const search = String(filters.search || '').trim().toLowerCase();
    return rows.map((row) => this.folderNode(row.path, filters.storageType))
      .filter((folder) => !search || folder.name.toLowerCase().includes(search));
  }

  listTreePage(options = {}) {
    const page = pageValues(options);
    const includeRoot = page.offset === 0;
    const rowLimit = page.limit - (includeRoot ? 1 : 0);
    const rowOffset = Math.max(0, page.offset - 1);
    const rows = rowLimit > 0
      ? all(this.db, 'SELECT path FROM virtual_folders ORDER BY path LIMIT ? OFFSET ?', [rowLimit, rowOffset])
      : [];
    const nodes = rows.map((row) => this.folderNode(row.path, options.storageType));
    if (includeRoot) nodes.unshift(this.folderNode('', options.storageType));
    const total = 1 + Number(get(this.db, 'SELECT COUNT(1) AS c FROM virtual_folders')?.c || 0);
    const nextOffset = page.offset + nodes.length;
    return Object.freeze({
      nodes, cursor: nextOffset >= total ? null : String(nextOffset),
      list_complete: nextOffset >= total,
    });
  }

  folderNode(path, storageType) {
    return Object.freeze({
      path, name: folderName(path), parentPath: folderParent(path),
      fileCount: this.fileCount(path, storageType),
      childCount: this.childCount(path),
    });
  }

  fileCount(path, storageType) {
    const clauses = ['folder_path = ?'];
    const params = [path];
    if (storageType && storageType !== 'all') {
      clauses.push('storage_type = ?');
      params.push(String(storageType));
    }
    return Number(get(this.db, `SELECT COUNT(1) AS c FROM files WHERE ${clauses.join(' AND ')}`, params)?.c || 0);
  }

  childCount(path) {
    const query = directFolderQuery(path);
    return Number(get(this.db, `SELECT COUNT(1) AS c FROM virtual_folders ${query.sql}`, query.params)?.c || 0);
  }

  stats(filters = {}) {
    const clauses = [];
    const params = [];
    for (const [field, value] of [['storage_type', filters.storageType], ['visibility', filters.visibility]]) {
      if (value && value !== 'all') {
        clauses.push(`${field} = ?`);
        params.push(String(value));
      }
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = all(this.db, `SELECT storage_type, mime_type, COUNT(1) AS c
      FROM files ${where} GROUP BY storage_type, mime_type`, params);
    const result = {
      total: 0,
      byType: { image: 0, video: 0, audio: 0, document: 0 },
      byStorage: Object.fromEntries(STORAGE_TYPES.map((type) => [type, 0])),
    };
    for (const row of rows) {
      const count = Number(row.c || 0);
      result.byType[fileTypeFromMime(row.mime_type)] += count;
      result.byStorage[row.storage_type] = (result.byStorage[row.storage_type] || 0) + count;
      result.total += count;
    }
    return result;
  }
}

module.exports = { DriveQueryRepository };
