export class StorageConfigError extends Error {
  constructor(code, cause = null) {
    super(code, cause ? { cause } : undefined);
    this.name = 'StorageConfigError';
    this.code = code;
    this.status = 503;
  }
}

export function unavailable(cause = null) {
  return new StorageConfigError('STORAGE_CONFIG_UNAVAILABLE', cause);
}
