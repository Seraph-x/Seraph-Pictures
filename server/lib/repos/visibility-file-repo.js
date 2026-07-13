const { all, get, run } = require('../../db');
const {
  createAccessMetadata,
  updateVisibility,
} = require('../../../shared/security/file-metadata.cjs');
const { FileRepository, normalizeFolderPath } = require('./file-repo');

const LEGACY_COLUMN_DEFINITIONS = Object.freeze({
  visibility: "TEXT NOT NULL DEFAULT 'public'",
  upload_source: "TEXT NOT NULL DEFAULT 'legacy'",
  access_version: 'INTEGER NOT NULL DEFAULT 1',
  expires_at: 'INTEGER',
});

function accessMetadata(row) {
  return Object.freeze({
    visibility: row.visibility,
    uploadSource: row.upload_source,
    accessVersion: row.access_version,
    expiresAt: row.expires_at,
  });
}

function enrichFile(file) {
  if (!file) return null;
  return Object.freeze({
    ...file,
    metadata: Object.freeze({ ...file.metadata, ...accessMetadata(file) }),
  });
}

class VisibilityFileRepository extends FileRepository {
  ensureSchema() {
    super.ensureSchema();
    const columns = new Set(all(this.db, 'PRAGMA table_info(files)').map((column) => column.name));
    for (const [name, definition] of Object.entries(LEGACY_COLUMN_DEFINITIONS)) {
      if (!columns.has(name)) run(this.db, `ALTER TABLE files ADD COLUMN ${name} ${definition}`);
    }
  }

  create(file) {
    const now = Date.now();
    const folderPath = normalizeFolderPath(file.folderPath);
    if (folderPath) this.ensureFolderPath(folderPath);
    const access = file.visibility
      ? file
      : createAccessMetadata({ uploadSource: file.uploadSource || 'image-host' });
    run(this.db, this.insertSql(), [
      file.id, file.storageConfigId, file.storageType, file.storageKey, file.fileName,
      file.fileSize || 0, file.mimeType || 'application/octet-stream',
      file.listType || 'None', file.label || 'None', file.liked ? 1 : 0,
      access.visibility, access.uploadSource, access.accessVersion, file.expiresAt || null,
      JSON.stringify(file.extra || {}), folderPath, now, now,
    ]);
    return this.getById(file.id);
  }

  insertSql() {
    return `INSERT INTO files(
      id, storage_config_id, storage_type, storage_key, file_name,
      file_size, mime_type, list_type, label, liked, visibility, upload_source,
      access_version, expires_at, extra_json, folder_path, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  }

  getById(id) {
    return enrichFile(super.getById(id));
  }

  list(options = {}) {
    const payload = super.list(options);
    if (!payload.keys.length) return payload;
    const ids = payload.keys.map((item) => item.name);
    const placeholders = ids.map(() => '?').join(', ');
    const rows = all(
      this.db,
      `SELECT id, visibility, upload_source, access_version, expires_at
       FROM files WHERE id IN (${placeholders})`,
      ids,
    );
    const byId = new Map(rows.map((row) => [row.id, accessMetadata(row)]));
    return Object.freeze({
      ...payload,
      keys: payload.keys.map((item) => Object.freeze({
        ...item,
        metadata: Object.freeze({ ...item.metadata, ...byId.get(item.name) }),
      })),
    });
  }

  updateVisibility(id, options) {
    const current = this.getById(id);
    if (!current) return null;
    const access = updateVisibility({
      metadata: current.metadata,
      visibility: options.visibility,
      actor: options.actor,
      ownershipTransferred: options.ownershipTransferred,
    });
    run(
      this.db,
      `UPDATE files SET visibility = ?, upload_source = ?, access_version = ?, updated_at = ?
       WHERE id = ?`,
      [access.visibility, access.uploadSource, access.accessVersion, Date.now(), id],
    );
    if (access.owner === 'admin') super.updateMetadata(id, { extra: { owner: 'admin' } });
    return this.getById(id);
  }
}

module.exports = { VisibilityFileRepository };
