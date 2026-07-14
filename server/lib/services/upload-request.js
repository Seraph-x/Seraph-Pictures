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

function normalizeDockerUploadAccess(input) {
  if (!input.authenticated) {
    return Object.freeze({ uploadSource: 'guest', visibility: 'public' });
  }
  const uploadSource = String(input.uploadSource || 'image-host').trim();
  if (!['image-host', 'drive'].includes(uploadSource)) {
    throw requestError('FILE_UPLOAD_SOURCE_INVALID');
  }
  return Object.freeze({
    uploadSource,
    visibility: uploadSource === 'drive' ? 'private' : 'public',
  });
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

module.exports = {
  normalizeDockerUploadSelection, normalizeDockerUploadAccess, readUploadOperationId,
};
