function referenceInput({ operationId, storageId, state }) {
  return Object.freeze({ operationId, storageId, state });
}

function reconciliationError(writeError, cleanupError) {
  const error = new AggregateError(
    [writeError, cleanupError],
    'STORAGE_WRITE_RECONCILIATION_REQUIRED',
  );
  error.code = 'STORAGE_WRITE_RECONCILIATION_REQUIRED';
  error.status = 500;
  return error;
}

async function cleanupFailedWrite(options) {
  const { adapter, storageRepo, operationId, uploadInput, uploadResult, writeError } = options;
  const storageKey = uploadResult?.storageKey || uploadInput.storageKey;
  try {
    await adapter.delete({ storageKey, metadata: uploadResult?.metadata || {} });
  } catch (cleanupError) {
    throw reconciliationError(writeError, cleanupError);
  }
  storageRepo.releaseReference(operationId);
  throw writeError;
}

async function executeStorageWrite(options) {
  const {
    storageRepo, fileRepo, adapter, storageConfig,
    operationId, uploadInput, buildFileRecord,
  } = options;
  const identity = { operationId, storageId: storageConfig.id };
  storageRepo.reserveReference(referenceInput({ ...identity, state: 'reserved' }));
  storageRepo.reserveReference(referenceInput({ ...identity, state: 'committing' }));
  let uploadResult;
  try {
    uploadResult = await adapter.upload(uploadInput);
    const file = storageRepo.commitReference(operationId, () => (
      fileRepo.create(buildFileRecord(uploadResult))
    ));
    return Object.freeze({ file, uploadResult });
  } catch (writeError) {
    return cleanupFailedWrite({
      adapter, storageRepo, operationId, uploadInput, uploadResult, writeError,
    });
  }
}

module.exports = { executeStorageWrite };
