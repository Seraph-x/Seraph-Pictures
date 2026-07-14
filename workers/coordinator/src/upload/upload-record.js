import { createMultipartState } from './state-machine.js';

const OPERATION_PADDING = 5;

function operationId(uploadId, sequence, name) {
  return `${uploadId}:${String(sequence).padStart(OPERATION_PADDING, '0')}:${name}`;
}

export function createUploadRecord(plan) {
  const objectKey = `multipart/${plan.uploadId}`;
  const state = createMultipartState({ ...plan, objectKey });
  const publishSequence = plan.totalParts + 3;
  return Object.freeze({
    plan,
    state,
    objectKey,
    fileId: `r2:${plan.uploadId}`,
    customMetadata: Object.freeze({
      uploadId: plan.uploadId,
      rootDigest: plan.rootDigest,
      expectedSize: String(plan.expectedSize),
      storageConfigId: plan.storageConfigId,
      storageGeneration: plan.storageGeneration,
    }),
    operations: Object.freeze({
      reserve: operationId(plan.uploadId, 1, 'reserve'),
      publish: operationId(plan.uploadId, publishSequence, 'publish'),
      consume: operationId(plan.uploadId, publishSequence + 1, 'consume'),
      cancel: operationId(plan.uploadId, publishSequence + 2, 'cancel'),
      reference: operationId(plan.uploadId, publishSequence + 3, 'storage-reference'),
    }),
  });
}

export function withState(record, state) {
  return Object.freeze({ ...record, state });
}
