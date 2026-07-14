function lifecycleError(message, code = message, status = 500, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  error.status = status;
  return error;
}

function reconciliationError(cause) {
  return lifecycleError(
    'Storage lifecycle result requires reconciliation.',
    'STORAGE_RECONCILIATION_REQUIRED',
    503,
    cause,
  );
}

function exactProfile(storageRepo, storageId) {
  const profile = storageRepo.getById(storageId, true);
  if (profile) return profile;
  throw lifecycleError('STORAGE_PROFILE_NOT_FOUND', 'STORAGE_PROFILE_NOT_FOUND', 404);
}

function operationId(kind, fileId, destinationStorageId) {
  if (kind === 'delete') return `delete:${fileId}`;
  return `transfer:${fileId}:${destinationStorageId}`;
}

function filePayload(file, extra = {}) {
  return Object.freeze({
    storageKey: file.storage_key,
    metadata: file.metadata,
    operationId: extra.operationId,
  });
}

async function readSource(adapter, file, operation) {
  const response = await adapter.download(filePayload(file, { operationId: operation }));
  if (!response?.ok) {
    throw lifecycleError('Source object is unavailable.', 'STORAGE_SOURCE_UNAVAILABLE', 502);
  }
  return response.arrayBuffer();
}

function destinationKey(file, destination) {
  const prefix = destination.type === 'huggingface' ? 'uploads/' : '';
  const folder = file.folder_path ? `${file.folder_path}/` : '';
  return `${prefix}${folder}${file.id}`;
}

function assertTransferArtifact(artifact) {
  const storageKey = String(artifact?.storageKey || '').trim();
  if (!storageKey) throw lifecycleError('Destination write returned incomplete metadata.');
  return Object.freeze({
    storageKey,
    metadata: Object.freeze({ ...(artifact.metadata || {}) }),
  });
}

function assertRetryEvidence(lifecycle) {
  if (lifecycle.state !== 'reconciliation' || lifecycle.artifact) return;
  throw reconciliationError(new Error('Destination write outcome remains ambiguous.'));
}

function migrationResult(operation, destinationStorageId) {
  return Object.freeze({
    migrated: true,
    operationId: operation,
    storageId: destinationStorageId,
  });
}

function isCompletedTransfer(file, operation, destinationStorageId) {
  return file?.storage_config_id === destinationStorageId
    && file.metadata?.storageLifecycleOperationId === operation;
}

class StorageLifecycleService {
  constructor({ db, storageRepo, fileRepo, storageFactory }) {
    this.db = db;
    this.storageRepo = storageRepo;
    this.fileRepo = fileRepo;
    this.storageFactory = storageFactory;
  }

  async deleteFile(fileIdValue) {
    const fileId = String(fileIdValue || '').trim();
    const operation = operationId('delete', fileId);
    const lifecycle = this.storageRepo.prepareFileDelete({ fileId, operationId: operation });
    if (!lifecycle) return Object.freeze({ deleted: false, reason: 'not-found' });
    const file = this.fileRepo.getById(fileId);
    const profile = exactProfile(this.storageRepo, lifecycle.sourceStorageId);
    const adapter = this.storageFactory.createAdapter(profile);
    try {
      const confirmed = await adapter.delete(filePayload(file, { operationId: operation }));
      if (confirmed !== true) throw lifecycleError('Backend deletion was not confirmed.');
      this.storageRepo.completeFileDelete(operation);
      return Object.freeze({ deleted: true, operationId: operation });
    } catch (error) {
      this.storageRepo.markLifecycleReconciliation(operation, error);
      throw reconciliationError(error);
    }
  }

  async migrateFile(fileIdValue, destinationStorageIdValue) {
    const fileId = String(fileIdValue || '').trim();
    const destinationStorageId = String(destinationStorageIdValue || '').trim();
    const operation = operationId('transfer', fileId, destinationStorageId);
    const currentFile = this.fileRepo.getById(fileId);
    if (isCompletedTransfer(currentFile, operation, destinationStorageId)) {
      return migrationResult(operation, destinationStorageId);
    }
    const lifecycle = this.storageRepo.prepareFileTransfer({
      fileId, operationId: operation, destinationStorageId,
    });
    if (!lifecycle) throw lifecycleError('FILE_NOT_FOUND', 'FILE_NOT_FOUND', 404);
    assertRetryEvidence(lifecycle);
    const file = this.fileRepo.getById(fileId);
    const source = exactProfile(this.storageRepo, lifecycle.sourceStorageId);
    const destination = exactProfile(this.storageRepo, destinationStorageId);
    try {
      const artifact = assertTransferArtifact(lifecycle.artifact || await this.writeDestination({
        file, source, destination, operation,
      }));
      if (!lifecycle.artifact) this.storageRepo.saveTransferArtifact(operation, artifact);
      await this.removeSource({ file, source, operation });
      this.storageRepo.completeFileTransfer(operation, destination.type);
      return migrationResult(operation, destination.id);
    } catch (error) {
      this.storageRepo.markLifecycleReconciliation(operation, error);
      throw reconciliationError(error);
    }
  }

  async writeDestination({ file, source, destination, operation }) {
    const sourceAdapter = this.storageFactory.createAdapter(source);
    const destinationAdapter = this.storageFactory.createAdapter(destination);
    const buffer = await readSource(sourceAdapter, file, operation);
    return destinationAdapter.upload({
      buffer,
      fileName: file.file_name,
      fileSize: file.file_size,
      mimeType: file.mime_type,
      storageKey: destinationKey(file, destination),
      operationId: operation,
    });
  }

  async removeSource({ file, source, operation }) {
    const adapter = this.storageFactory.createAdapter(source);
    const confirmed = await adapter.delete(filePayload(file, { operationId: operation }));
    if (confirmed !== true) throw lifecycleError('Source deletion was not confirmed.');
  }
}

module.exports = { StorageLifecycleService };
