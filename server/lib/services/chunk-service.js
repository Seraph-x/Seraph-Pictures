const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { run, get, all } = require('../../db');
const { normalizeFolderPath } = require('../repos/file-repo');
const { createChunkPlan, validateChunkPart } = require('./chunk-policy');

class ChunkUploadService {
  constructor({ db, config, uploadService }) {
    this.db = db;
    this.config = config;
    this.uploadService = uploadService;
    this.ensureSchema();
    fs.mkdirSync(this.config.chunkDir, { recursive: true });
  }

  ensureSchema() {
    const columns = all(this.db, 'PRAGMA table_info(chunk_uploads)');
    this.ensureColumn(columns, 'folder_path', "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn(columns, 'chunk_size', 'INTEGER NOT NULL DEFAULT 0');
    this.ensureColumn(columns, 'received_bytes', 'INTEGER NOT NULL DEFAULT 0');
  }

  ensureColumn(columns, name, definition) {
    if (columns.some((column) => column.name === name)) return;
    run(this.db, `ALTER TABLE chunk_uploads ADD COLUMN ${name} ${definition}`);
  }

  initTask({ fileName, fileSize, fileType, totalChunks, storageMode, storageId, folderPath }) {
    const plan = createChunkPlan({ fileSize, chunkSize: this.config.chunkSize, totalChunks });
    const uploadId = crypto.randomUUID();
    const now = Date.now();
    const expiresAt = now + 60 * 60 * 1000;
    const normalizedFolderPath = normalizeFolderPath(folderPath);

    run(
      this.db,
      `INSERT INTO chunk_uploads(
         upload_id, file_name, file_size, file_type, total_chunks, chunk_size,
         received_bytes, storage_mode, storage_config_id, folder_path, created_at, expires_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        uploadId,
        fileName,
        plan.fileSize,
        fileType || 'application/octet-stream',
        plan.totalChunks,
        plan.chunkSize,
        0,
        storageMode || null,
        storageId || null,
        normalizedFolderPath,
        now,
        expiresAt,
      ]
    );

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
    if (Date.now() > task.expires_at) {
      run(this.db, 'DELETE FROM chunk_uploads WHERE upload_id = ?', [uploadId]);
      fs.rmSync(this.taskDir(uploadId), { recursive: true, force: true });
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
    if (combinedSize !== plan.fileSize) {
      const error = new Error('Combined upload size does not match the declared file size.');
      error.code = 'UPLOAD_SIZE_MISMATCH';
      error.status = 400;
      throw error;
    }
    const combined = await fsp.readFile(combinedPath);

    const result = await this.uploadService.uploadFile({
      fileName: task.file_name,
      mimeType: task.file_type,
      fileSize: combined.byteLength,
      buffer: combined,
      storageMode: task.storage_mode,
      storageId: task.storage_config_id,
      folderPath: normalizeFolderPath(task.folder_path),
    });

    await this.cleanupTask(uploadId);

    return result;
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
    run(this.db, 'DELETE FROM chunk_uploads WHERE upload_id = ?', [uploadId]);
    await fsp.rm(this.taskDir(uploadId), { recursive: true, force: true });
  }
}

module.exports = {
  ChunkUploadService,
};
