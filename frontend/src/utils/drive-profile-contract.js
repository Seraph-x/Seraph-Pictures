function queryPath(path, entries) {
  const query = new URLSearchParams();
  for (const [key, value] of entries) {
    if (value !== '' && value !== false && value != null) query.set(key, String(value));
  }
  return `${path}?${query.toString()}`;
}

export function buildDriveTreePath(options = {}) {
  const input = typeof options === 'string' ? { storage: options } : options;
  return queryPath('/api/drive/tree', [
    ['storage', input.storage && input.storage !== 'all' ? input.storage : ''],
    ['storageId', input.storageId],
  ]);
}

export function buildDriveExplorerPath(options = {}) {
  return queryPath('/api/drive/explorer', [
    ['path', options.path],
    ['storage', options.storage && options.storage !== 'all' ? options.storage : ''],
    ['storageId', options.storageId],
    ['search', options.search],
    ['listType', options.listType && options.listType !== 'all' ? options.listType : ''],
    ['limit', options.limit ?? 100],
    ['cursor', options.cursor],
    ['includeStats', options.includeStats ? 1 : ''],
  ]);
}

export function buildMigrationPayload(options) {
  const ids = Object.freeze([...(options.ids || [])]);
  const destinationStorageId = String(options.destinationStorageId || '').trim();
  if (!ids.length || !destinationStorageId) throw new Error('STORAGE_MIGRATION_INPUT_REQUIRED');
  return Object.freeze({ ids, destinationStorageId });
}

export function migrationDestinations(profiles, sourceStorageIds = []) {
  const sourceIds = new Set(Array.isArray(sourceStorageIds) ? sourceStorageIds : [sourceStorageIds]);
  return Object.freeze((Array.isArray(profiles) ? profiles : []).filter((profile) => (
    profile.enabled && !sourceIds.has(profile.id)
  )));
}
