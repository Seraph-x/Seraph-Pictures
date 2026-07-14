const { get, run } = require('../../../db');

function integrityError() {
  const error = new Error('STORAGE_PROFILE_INTEGRITY_ERROR');
  error.code = 'STORAGE_PROFILE_INTEGRITY_ERROR';
  error.status = 500;
  return error;
}

function parseArtifact(value) {
  if (!value) return null;
  return JSON.parse(value);
}

function mapRow(row) {
  if (!row) return null;
  return Object.freeze({
    operationId: row.operation_id,
    fileId: row.file_id,
    operationType: row.operation_type,
    sourceStorageId: row.source_storage_config_id,
    destinationStorageId: row.destination_storage_config_id,
    state: row.state,
    artifact: parseArtifact(row.artifact_json),
    errorMessage: row.error_message,
  });
}

class StorageLifecycleRepository {
  constructor({ db, clock = Date }) {
    this.db = db;
    this.clock = clock;
  }

  findByFileId(fileId) {
    return mapRow(get(this.db, 'SELECT * FROM storage_file_lifecycle WHERE file_id = ?', [fileId]));
  }

  prepareDelete({ fileId, operationId }) {
    const file = get(this.db, 'SELECT * FROM files WHERE id = ?', [fileId]);
    if (!file) return null;
    const current = this.findByFileId(fileId);
    if (current) return this.assertCurrent(current, { operationId, operationType: 'delete' });
    return this.insert({
      fileId, operationId, operationType: 'delete',
      sourceStorageId: file.storage_config_id,
      destinationStorageId: null,
      state: 'deleting',
    });
  }

  prepareTransfer({ fileId, operationId, destinationStorageId }) {
    const file = get(this.db, 'SELECT * FROM files WHERE id = ?', [fileId]);
    if (!file) return null;
    this.assertWritableDestination(destinationStorageId);
    const current = this.findByFileId(fileId);
    if (current) return this.assertCurrent(current, {
      operationId, operationType: 'transfer', destinationStorageId,
    });
    return this.insert({
      fileId, operationId, operationType: 'transfer',
      sourceStorageId: file.storage_config_id,
      destinationStorageId,
      state: 'writing_destination',
    });
  }

  assertWritableDestination(storageId) {
    const profile = get(this.db, 'SELECT enabled FROM storage_configs WHERE id = ?', [storageId]);
    if (profile?.enabled === 1) return;
    const error = new Error(profile ? 'STORAGE_NOT_WRITABLE' : 'STORAGE_PROFILE_NOT_FOUND');
    error.code = error.message;
    error.status = profile ? 409 : 404;
    throw error;
  }

  assertCurrent(current, expected) {
    const matches = current.operationId === expected.operationId
      && current.operationType === expected.operationType
      && (expected.destinationStorageId === undefined
        || current.destinationStorageId === expected.destinationStorageId);
    if (!matches) throw integrityError();
    return current;
  }

  insert(input) {
    const now = this.clock.now();
    run(this.db, `INSERT INTO storage_file_lifecycle(
      operation_id, file_id, operation_type, source_storage_config_id,
      destination_storage_config_id, state, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [
      input.operationId, input.fileId, input.operationType, input.sourceStorageId,
      input.destinationStorageId, input.state, now, now,
    ]);
    return this.findByFileId(input.fileId);
  }

  saveArtifact(operationId, artifact) {
    const result = run(this.db, `UPDATE storage_file_lifecycle
      SET artifact_json = ?, state = 'cleaning_source', error_message = NULL, updated_at = ?
      WHERE operation_id = ?`, [JSON.stringify(artifact), this.clock.now(), operationId]);
    if (Number(result.changes || 0) !== 1) throw integrityError();
  }

  markReconciliation(operationId, error) {
    const result = run(this.db, `UPDATE storage_file_lifecycle
      SET state = 'reconciliation', error_message = ?, updated_at = ?
      WHERE operation_id = ?`, [String(error?.message || error), this.clock.now(), operationId]);
    if (Number(result.changes || 0) !== 1) throw integrityError();
  }

  completeDelete(operationId) {
    const current = this.byOperation(operationId, 'delete');
    run(this.db, 'DELETE FROM files WHERE id = ?', [current.fileId]);
    this.remove(operationId);
  }

  completeTransfer(operationId, destinationType) {
    const current = this.byOperation(operationId, 'transfer');
    if (!current.artifact) throw integrityError();
    const file = get(this.db, 'SELECT extra_json FROM files WHERE id = ?', [current.fileId]);
    if (!file) throw integrityError();
    const extra = {
      ...JSON.parse(file.extra_json || '{}'),
      ...(current.artifact.metadata || {}),
      storageLifecycleOperationId: operationId,
    };
    run(this.db, `UPDATE files SET storage_config_id = ?, storage_type = ?, storage_key = ?,
      extra_json = ?, updated_at = ? WHERE id = ?`, [
      current.destinationStorageId, destinationType, current.artifact.storageKey,
      JSON.stringify(extra), this.clock.now(), current.fileId,
    ]);
    this.remove(operationId);
  }

  byOperation(operationId, operationType) {
    const current = mapRow(get(
      this.db, 'SELECT * FROM storage_file_lifecycle WHERE operation_id = ?', [operationId],
    ));
    if (!current || current.operationType !== operationType) throw integrityError();
    return current;
  }

  remove(operationId) {
    const result = run(this.db, 'DELETE FROM storage_file_lifecycle WHERE operation_id = ?', [operationId]);
    if (Number(result.changes || 0) !== 1) throw integrityError();
  }
}

module.exports = { StorageLifecycleRepository };
