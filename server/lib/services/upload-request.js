const OPERATION_ID_MAX_LENGTH = 128;

function requestError(code) {
  return Object.assign(new Error(code), { code, status: 400 });
}

function normalizeDockerUploadSelection(input) {
  const storageMode = String(input.storageMode || '').trim().toLowerCase();
  const storageId = String(input.storageId || input.guestStorageId || '').trim();
  if (!storageMode || !storageId) throw requestError('STORAGE_SELECTION_REQUIRED');
  return Object.freeze({ storageMode, storageId });
}

function readUploadOperationId(request) {
  const supplied = request.headers.get('Idempotency-Key')
    || request.headers.get('X-Upload-Operation-Id');
  if (!supplied) return undefined;
  const normalized = supplied.trim();
  if (!normalized || normalized.length > OPERATION_ID_MAX_LENGTH) {
    throw requestError('STORAGE_REFERENCE_OPERATION_INVALID');
  }
  return `upload:${normalized}`;
}

module.exports = { normalizeDockerUploadSelection, readUploadOperationId };
