function buildMetadataInput({ payload, artifact, profile }) {
  return Object.freeze({
    ...payload,
    artifact,
    storageConfigId: profile.id,
    storageType: profile.type,
    storageGeneration: profile.generation,
  });
}

function buildReferenceInput(operation, profile, state) {
  return Object.freeze({
    operationId: operation.operationId,
    storageId: profile.id,
    expiresAt: operation.expiresAt,
    state,
  });
}

export async function executeStorageWrite(options) {
  const {
    selection, operation, payload, resolver, adapterFactory,
    references, backend, metadata,
  } = options;
  const profile = await resolver.resolve({ ...selection, forWrite: true });
  const adapter = adapterFactory({ profile });
  await references.reserve(buildReferenceInput(operation, profile, 'reserved'));
  await references.commitStart(buildReferenceInput(operation, profile, 'committing'));
  const artifact = await backend.write({ adapter, profile, payload });
  const metadataInput = buildMetadataInput({ payload, artifact, profile });
  const result = await metadata.create(metadataInput);
  await references.commitFinish({ operationId: operation.operationId });
  return result;
}
