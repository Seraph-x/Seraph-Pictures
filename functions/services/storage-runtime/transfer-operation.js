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

function operationId(record) {
  return String(record.metadata?.storageOperationId || '').trim()
    || `migration:${String(record.fileId || '').trim()}`;
}

export async function executeStorageTransfer(options) {
  const {
    record, destination, resolver, adapterFactory,
    references, backend, metadata,
  } = options;
  const sourceProfile = await resolver.resolve(sourceSelection(record));
  const destinationProfile = await resolver.resolve({ ...destination, forWrite: true });
  const operation = operationId(record);
  await references.transferStart({
    operationId: operation,
    destinationStorageId: destinationProfile.id,
  });
  const sourceAdapter = adapterFactory({ profile: sourceProfile });
  const destinationAdapter = adapterFactory({ profile: destinationProfile });
  const artifact = await backend.copy({
    record, sourceAdapter, destinationAdapter,
    sourceProfile, destinationProfile,
  });
  const result = await metadata.replace({
    record, artifact,
    storageConfigId: destinationProfile.id,
    storageType: destinationProfile.type,
    storageGeneration: destinationProfile.generation,
  });
  await backend.remove({ adapter: sourceAdapter, profile: sourceProfile, record });
  await references.transferFinish({ operationId: operation });
  return result;
}
