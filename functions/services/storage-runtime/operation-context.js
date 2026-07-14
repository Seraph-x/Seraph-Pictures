const DEFAULT_REFERENCE_TTL_MS = 15 * 60 * 1_000;

export function createStorageOperationContext({
  ids = { create: () => crypto.randomUUID() },
  clock = Date,
  ttlMs = DEFAULT_REFERENCE_TTL_MS,
} = {}) {
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
    throw Object.assign(new Error('STORAGE_REFERENCE_EXPIRY_INVALID'), {
      code: 'STORAGE_REFERENCE_EXPIRY_INVALID',
    });
  }
  const operationId = ids.create();
  if (typeof operationId !== 'string' || !operationId) {
    throw Object.assign(new Error('STORAGE_REFERENCE_OPERATION_REQUIRED'), {
      code: 'STORAGE_REFERENCE_OPERATION_REQUIRED',
    });
  }
  return Object.freeze({ operationId, expiresAt: clock.now() + ttlMs });
}
