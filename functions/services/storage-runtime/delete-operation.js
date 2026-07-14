function operationId(record) {
  const persisted = String(record.metadata?.storageOperationId || '').trim();
  if (persisted) return persisted;
  return `migration:${String(record.fileId || '').trim()}`;
}

function sourceSelection(record) {
  const storageId = String(record.metadata?.storageConfigId || '').trim();
  return Object.freeze({
    storageId: storageId || undefined,
    storageMode: String(record.metadata?.storageType || '').trim().toLowerCase(),
    forWrite: false,
    persisted: true,
    legacy: !storageId,
  });
}

export async function executeStorageDelete(options) {
  const {
    record, resolver, adapterFactory, references, backend, metadata,
  } = options;
  const profile = await resolver.resolve(sourceSelection(record));
  const operation = operationId(record);
  const adapter = adapterFactory({ profile });
  await references.releaseStart({ operationId: operation });
  await backend.remove({ adapter, profile, record });
  const result = await metadata.remove({ record });
  await references.releaseFinish({ operationId: operation });
  return result;
}
