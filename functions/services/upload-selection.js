function selectionError() {
  return Object.assign(new Error('STORAGE_SELECTION_REQUIRED'), {
    code: 'STORAGE_SELECTION_REQUIRED',
    status: 400,
  });
}

export function normalizeUploadSelection(input) {
  if (!input.isAdmin) {
    return Object.freeze({ storageMode: 'telegram', storageId: '' });
  }
  const storageMode = String(input.storageMode || '').trim().toLowerCase();
  const storageId = String(input.storageId || '').trim();
  if (!input.isApi && (!storageMode || !storageId)) throw selectionError();
  return Object.freeze({ storageMode, storageId });
}
