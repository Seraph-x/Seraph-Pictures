export function publicUploadResult(record) {
  return Object.freeze({
    uploadId: record.plan.uploadId,
    objectKey: record.objectKey,
    fileId: record.fileId,
    partSize: record.plan.partSize,
    totalParts: record.plan.totalParts,
    customMetadata: record.customMetadata,
    phase: record.state.phase,
    expiresAt: record.plan.expiresAt,
    uploadedParts: record.state.parts.length,
    fileName: record.plan.fileName,
    fileSize: record.plan.expectedSize,
    storageConfigId: record.plan.storageConfigId,
    storageType: record.plan.storageType,
    storageGeneration: record.plan.storageGeneration,
  });
}

export function multipartMetadataRecord(record) {
  return Object.freeze({
    uploadId: record.plan.uploadId,
    operationId: record.operations.publish,
    key: record.fileId,
    value: '',
    metadata: Object.freeze({
      TimeStamp: record.plan.createdAt,
      ListType: 'None',
      Label: 'None',
      liked: false,
      fileName: record.plan.fileName,
      fileSize: record.plan.expectedSize,
      fileType: record.plan.fileType,
      folderPath: record.plan.folderPath || undefined,
      storageType: record.plan.storageType,
      storageConfigId: record.plan.storageConfigId,
      storageGeneration: record.plan.storageGeneration,
      storageOperationId: record.operations.reference,
      r2Key: record.objectKey,
      visibility: record.plan.visibility,
      owner: record.plan.owner,
      accessVersion: 1,
      chunked: true,
      totalChunks: record.plan.totalParts,
    }),
  });
}
