function referenceError(code) {
  return Object.assign(new Error(code), { code });
}

function requiredString(value, code) {
  if (typeof value !== 'string' || !value.trim()) throw referenceError(code);
  return value.trim();
}

function protectedIds(storageId, destinationStorageId = null) {
  return Object.freeze(destinationStorageId
    ? [storageId, destinationStorageId]
    : [storageId]);
}

function immutableRecord(input) {
  return Object.freeze({
    ...input,
    protectedStorageIds: protectedIds(input.storageId, input.destinationStorageId),
  });
}

export function createReservation({ operationId, storageId, expiresAt, now }) {
  const normalizedExpiry = Number(expiresAt);
  if (!Number.isFinite(normalizedExpiry) || normalizedExpiry <= now) {
    throw referenceError('STORAGE_REFERENCE_EXPIRY_INVALID');
  }
  return immutableRecord({
    operationId: requiredString(operationId, 'STORAGE_REFERENCE_OPERATION_REQUIRED'),
    storageId: requiredString(storageId, 'STORAGE_PROFILE_ID_REQUIRED'),
    destinationStorageId: null,
    state: 'reserved',
    expiresAt: normalizedExpiry,
    backendWriteStarted: false,
    lastAction: 'reserve',
    createdAt: now,
    updatedAt: now,
  });
}

export function createPermanentReference({ operationId, storageId, now }) {
  return immutableRecord({
    operationId: requiredString(operationId, 'STORAGE_REFERENCE_OPERATION_REQUIRED'),
    storageId: requiredString(storageId, 'STORAGE_PROFILE_ID_REQUIRED'),
    destinationStorageId: null,
    state: 'permanent',
    expiresAt: now,
    backendWriteStarted: true,
    lastAction: 'migration',
    createdAt: now,
    updatedAt: now,
  });
}

export function assertReservationMatch(record, input) {
  if (record.storageId !== input.storageId) {
    throw referenceError('STORAGE_REFERENCE_OPERATION_CONFLICT');
  }
  return record;
}

export function commitStart(record, now) {
  if (record.state === 'committing' || record.state === 'permanent') return record;
  if (record.state !== 'reserved') throw referenceError('STORAGE_REFERENCE_TRANSITION_INVALID');
  return immutableRecord({
    ...record, state: 'committing', backendWriteStarted: true, updatedAt: now,
  });
}

export function commitFinish(record, now) {
  if (record.state === 'permanent' && record.lastAction === 'commit') return record;
  if (record.state !== 'committing') throw referenceError('STORAGE_REFERENCE_TRANSITION_INVALID');
  return immutableRecord({ ...record, state: 'permanent', lastAction: 'commit', updatedAt: now });
}

export function releaseStart(record, now) {
  if (record.state === 'releasing') return record;
  if (record.state !== 'permanent') throw referenceError('STORAGE_REFERENCE_TRANSITION_INVALID');
  return immutableRecord({ ...record, state: 'releasing', lastAction: 'release', updatedAt: now });
}

export function transferStart(record, destinationStorageId, now) {
  const destination = requiredString(destinationStorageId, 'STORAGE_PROFILE_ID_REQUIRED');
  if (record.state === 'transferring') {
    if (record.destinationStorageId === destination) return record;
    throw referenceError('STORAGE_REFERENCE_OPERATION_CONFLICT');
  }
  if (record.state !== 'permanent' || record.storageId === destination) {
    throw referenceError('STORAGE_REFERENCE_TRANSITION_INVALID');
  }
  return immutableRecord({
    ...record,
    state: 'transferring',
    destinationStorageId: destination,
    backendWriteStarted: true,
    lastAction: 'transfer',
    updatedAt: now,
  });
}

export function transferFinish(record, now) {
  if (record.state === 'permanent' && record.lastAction === 'transfer') return record;
  if (record.state !== 'transferring') throw referenceError('STORAGE_REFERENCE_TRANSITION_INVALID');
  return immutableRecord({
    ...record,
    storageId: record.destinationStorageId,
    destinationStorageId: null,
    state: 'permanent',
    lastAction: 'transfer',
    updatedAt: now,
  });
}

export function notFound() {
  return referenceError('STORAGE_REFERENCE_NOT_FOUND');
}
