const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { run, get, all } = require('../../db');
const { normalizeFolderPath } = require('../repos/file-repo');
const { createChunkPlan, validateChunkPart } = require('./chunk-policy');

const CHUNK_TASK_TTL_MS = 60 * 60 * 1000;

class ChunkUploadService {
  constructor({ db, config, uploadService, storageRepo }) {
    this.db = db;
    this.config = config;
    this.uploadService = uploadService;
    this.storageRepo = storageRepo;
    this.ensureSchema();
    fs.mkdirSync(this.config.chunkDir, { recursive: true });
  }

  ensureSchema() {
    const columns = all(this.db, 'PRAGMA table_info(chunk_uploads)');
    this.ensureColumn(columns, 'folder_path', "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn(columns, 'chunk_size', 'INTEGER NOT NULL DEFAULT 0');
    this.ensureColumn(columns, 'received_bytes', 'INTEGER NOT NULL DEFAULT 0');
    this.ensureColumn(columns, 'upload_source', "TEXT NOT NULL DEFAULT 'image-host'");
    this.ensureColumn(columns, 'visibility', "TEXT NOT NULL DEFAULT 'public'");
    this.ensureColumn(columns, 'write_state', "TEXT NOT NULL DEFAULT 'reserved'");
  }

  ensureColumn(columns, name, definition) {
    if (columns.some((column) => column.name === name)) return;
    run(this.db, `ALTER TABLE chunk_uploads ADD COLUMN ${name} ${definition}`);
  }

  initTask(options) {
    const {
      fileName, fileSize, fileType, totalChunks, storageMode, storageId, folderPath,
      uploadSource = 'image-host', visibility = 'public',
    } = options;
    const storage = this.uploadService.resolveStorage({ storageId, storageMode });
    const plan = createChunkPlan({ fileSize, chunkSize: this.config.chunkSize, totalChunks });
    const uploadId = crypto.randomUUID();
    const now = Date.now();
    const expiresAt = now + CHUNK_TASK_TTL_MS;
    const normalizedFolderPath = normalizeFolderPath(folderPath);

    this.storageRepo.createChunkReference(() => run(
      this.db,
      `INSERT INTO chunk_uploads(
         upload_id, file_name, file_size, file_type, total_chunks, chunk_size,
         received_bytes, storage_mode, storage_config_id, upload_source, visibility,
         folder_path, created_at, expires_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        uploadId,
        fileName,
        plan.fileSize,
        fileType || 'application/octet-stream',
        plan.totalChunks,
        plan.chunkSize,
        0,
        storage.type,
        storage.id,
        uploadSource,
        visibility,
        normalizedFolderPath,
        now,
        expiresAt,
      ]
    ));

    fs.mkdirSync(this.taskDir(uploadId), { recursive: true });

    return {
      uploadId,
      chunkSize: this.config.chunkSize,
      expiresAt,
    };
  }

  getTask(uploadId) {
    const task = get(this.db, 'SELECT * FROM chunk_uploads WHERE upload_id = ?', [uploadId]);
    if (!task) return null;
    if (Date.now() > task.expires_at && task.write_state === 'reserved') {
      fs.rmSync(this.taskDir(uploadId), { recursive: true, force: true });
      run(this.db, 'DELETE FROM chunk_uploads WHERE upload_id = ?', [uploadId]);
      return null;
    }
    return task;
  }

  taskDir(uploadId) {
    return path.join(this.config.chunkDir, uploadId);
  }

  chunkPath(uploadId, chunkIndex) {
    return path.join(this.taskDir(uploadId), `${Number(chunkIndex)}.part`);
  }

  async saveChunk({ uploadId, chunkIndex, buffer }) {
    const task = this.getTask(uploadId);
    if (!task) {
      throw new Error('Upload task not found or expired.');
    }
    const part = Buffer.from(buffer);
    validateChunkPart({
      plan: this.taskPlan(task),
      chunkIndex,
      byteLength: part.byteLength,
    });
    const partPath = this.chunkPath(uploadId, chunkIndex);
    const previousSize = await this.fileSize(partPath);
    await fsp.mkdir(this.taskDir(uploadId), { recursive: true });
    await fsp.writeFile(partPath, part);
    const receivedBytes = Number(task.received_bytes || 0) - previousSize + part.byteLength;
    run(this.db, 'UPDATE chunk_uploads SET received_bytes = ? WHERE upload_id = ?', [receivedBytes, uploadId]);

    return {
      success: true,
      chunkIndex,
      receivedBytes,
    };
  }

  async complete(uploadId) {
    const task = this.getTask(uploadId);
    if (!task) {
      throw new Error('Upload task not found or expired.');
    }

    const plan = this.taskPlan(task);
    const combinedPath = path.join(this.taskDir(uploadId), 'combined.tmp');
    const combinedSize = await this.mergeParts(uploadId, plan, combinedPath);
    this.assertCombinedSize(combinedSize, plan.fileSize);
    const combined = await fsp.readFile(combinedPath);
    run(this.db, `UPDATE chunk_uploads SET write_state = 'committing'
      WHERE upload_id = ?`, [uploadId]);
    const result = await this.uploadCombined({ task, uploadId, combined });
    await this.cleanupTask(uploadId);
    return result;
  }

  async uploadCombined({ task, uploadId, combined }) {
    try {
      return await this.uploadService.uploadFile({
        fileName: task.file_name,
        mimeType: task.file_type,
        fileSize: combined.byteLength,
        buffer: combined,
        storageMode: task.storage_mode,
        storageId: task.storage_config_id,
        folderPath: normalizeFolderPath(task.folder_path),
        uploadSource: task.upload_source,
        visibility: task.visibility,
        operationId: `chunk:${uploadId}`,
        onMetadataCommitted: () => run(
          this.db, 'DELETE FROM chunk_uploads WHERE upload_id = ?', [uploadId],
        ),
      });
    } catch (error) {
      if (error.storageCleanupConfirmed) {
        run(this.db, `UPDATE chunk_uploads SET write_state = 'reserved'
          WHERE upload_id = ?`, [uploadId]);
      }
      throw error;
    }
  }

  assertCombinedSize(actual, expected) {
    if (actual === expected) return;
    const error = new Error('Combined upload size does not match the declared file size.');
    error.code = 'UPLOAD_SIZE_MISMATCH';
    error.status = 400;
    throw error;
  }

  async cancel(uploadId) {
    const task = get(this.db, 'SELECT * FROM chunk_uploads WHERE upload_id = ?', [uploadId]);
    if (!task) return { cancelled: true };
    if (task.write_state === 'committing') {
      const error = new Error('CHUNK_CLEANUP_AMBIGUOUS');
      error.code = 'CHUNK_CLEANUP_AMBIGUOUS';
      error.status = 409;
      throw error;
    }
    await fsp.rm(this.taskDir(uploadId), { recursive: true, force: true });
    run(this.db, 'DELETE FROM chunk_uploads WHERE upload_id = ?', [uploadId]);
    return { cancelled: true };
  }

  taskPlan(task) {
    return createChunkPlan({
      fileSize: Number(task.file_size),
      chunkSize: Number(task.chunk_size),
      totalChunks: Number(task.total_chunks),
    });
  }

  async fileSize(filePath) {
    try {
      return (await fsp.stat(filePath)).size;
    } catch (error) {
      if (error.code === 'ENOENT') return 0;
      throw error;
    }
  }

  async mergeParts(uploadId, plan, combinedPath) {
    const output = await fsp.open(combinedPath, 'w');
    let totalBytes = 0;
    try {
      for (let index = 0; index < plan.totalChunks; index += 1) {
        const part = await this.readValidatedPart(uploadId, plan, index);
        await output.write(part);
        totalBytes += part.byteLength;
      }
    } finally {
      await output.close();
    }
    return totalBytes;
  }

  async readValidatedPart(uploadId, plan, chunkIndex) {
    let part;
    try {
      part = await fsp.readFile(this.chunkPath(uploadId, chunkIndex));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const missing = new Error(`Chunk ${chunkIndex} is missing.`);
      missing.code = 'INCOMPLETE_UPLOAD';
      missing.status = 400;
      throw missing;
    }
    validateChunkPart({ plan, chunkIndex, byteLength: part.byteLength });
    return part;
  }

  async cleanupTask(uploadId) {
    await fsp.rm(this.taskDir(uploadId), { recursive: true, force: true });
    run(this.db, 'DELETE FROM chunk_uploads WHERE upload_id = ?', [uploadId]);
  }
}

module.exports = {
  ChunkUploadService,
};
