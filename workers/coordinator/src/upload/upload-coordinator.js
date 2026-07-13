import { reduceMultipartState } from './state-machine.js';
import { sha256Hex } from './digest.js';
import { expectedPartLength, validateMultipartPlan } from './multipart-plan.js';
import { createUploadRecord, withState } from './upload-record.js';

function uploadError(code, cause) {
  const error = new Error(code, cause ? { cause } : undefined);
  error.code = code;
  return error;
}

function requireDependencies(service) {
  const requirements = [
    [service.repository, ['read', 'write']],
    [service.r2, ['createMultipartUpload', 'resumeMultipartUpload', 'head', 'delete']],
    [service.quota, ['reserve', 'consume', 'cancel']],
    [service.metadata, ['publish']],
    [service.alarms, ['schedule']],
  ];
  const invalid = requirements.some(([dependency, methods]) => (
    !dependency || methods.some((method) => typeof dependency[method] !== 'function')
  ));
  if (invalid) throw uploadError('MULTIPART_BINDING_MISSING');
}

function publicResult(record) {
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
  });
}

function samePlan(left, right) {
  return Object.keys(left).every((key) => left[key] === right[key]);
}

function byteLength(bytes) {
  if (bytes instanceof ArrayBuffer) return bytes.byteLength;
  if (ArrayBuffer.isView(bytes)) return bytes.byteLength;
  throw uploadError('MULTIPART_PART_INVALID');
}

function findPart(record, partNumber) {
  return record.state.parts.find((part) => part.partNumber === partNumber);
}

function assertExistingPart(existing, input) {
  if (existing.size !== byteLength(input.bytes) || existing.digest !== input.digest) {
    throw uploadError('MULTIPART_PART_CONFLICT');
  }
}

function completionReceipts(record) {
  return record.state.parts.map(({ partNumber, etag }) => ({ partNumber, etag }));
}

function objectMatches(record, object) {
  const metadata = object?.customMetadata || {};
  return object?.size === record.plan.expectedSize
    && metadata.uploadId === record.plan.uploadId
    && metadata.rootDigest === record.plan.rootDigest
    && metadata.expectedSize === String(record.plan.expectedSize);
}

function metadataRecord(record) {
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
      storageType: 'r2',
      r2Key: record.objectKey,
      visibility: record.plan.visibility,
      owner: record.plan.owner,
      accessVersion: 1,
      chunked: true,
      totalChunks: record.plan.totalParts,
    }),
  });
}

async function reconcileComplete(record, r2) {
  const upload = r2.resumeMultipartUpload(record.objectKey, record.state.r2UploadId);
  try {
    return await upload.complete(record.state.completionParts);
  } catch (error) {
    const object = await r2.head(record.objectKey);
    if (!object) throw error;
    return object;
  }
}

export class UploadCoordinatorService {
  constructor(dependencies = {}) {
    this.repository = dependencies.repository;
    this.r2 = dependencies.r2;
    this.quota = dependencies.quota;
    this.metadata = dependencies.metadata;
    this.alarms = dependencies.alarms;
  }

  async initialize(input) {
    requireDependencies(this);
    const plan = validateMultipartPlan(input);
    let record = await this.repository.read();
    if (record && !samePlan(record.plan, plan)) throw uploadError('MULTIPART_PLAN_CONFLICT');
    if (record && record.state.phase !== 'creating') return publicResult(record);
    if (!record) {
      record = createUploadRecord(plan);
      await this.repository.write(record);
    }
    await this.alarms.schedule(plan.expiresAt);
    await this.quota.reserve({
      uploadId: plan.uploadId,
      operationId: record.operations.reserve,
      bytes: plan.expectedSize,
      expiresAt: plan.expiresAt,
    });
    const upload = await this.r2.createMultipartUpload(record.objectKey, {
      httpMetadata: { contentType: plan.fileType },
      customMetadata: record.customMetadata,
    });
    const state = reduceMultipartState({
      state: record.state,
      event: { type: 'MULTIPART_CREATED', r2UploadId: upload.uploadId },
    });
    try {
      await this.repository.write(withState(record, state));
    } catch (cause) {
      throw uploadError('MULTIPART_CREATE_AMBIGUOUS', cause);
    }
    return publicResult(withState(record, state));
  }

  async uploadPart(input) {
    requireDependencies(this);
    const record = await this.readRecord(input.uploadId);
    const expected = expectedPartLength(record.plan, input.partNumber);
    if (byteLength(input.bytes) !== expected) throw uploadError('MULTIPART_PART_LENGTH_INVALID');
    const actualDigest = await sha256Hex(input.bytes);
    if (actualDigest !== input.digest) throw uploadError('MULTIPART_DIGEST_MISMATCH');
    const existing = findPart(record, input.partNumber);
    if (existing) { assertExistingPart(existing, input); return publicResult(record); }
    const upload = this.r2.resumeMultipartUpload(record.objectKey, record.state.r2UploadId);
    const receipt = await upload.uploadPart(input.partNumber, input.bytes);
    const state = reduceMultipartState({
      state: record.state,
      event: {
        type: 'PART_UPLOADED', partNumber: input.partNumber,
        size: expected, digest: input.digest, etag: receipt.etag,
      },
    });
    const next = withState(record, state);
    await this.repository.write(next);
    return publicResult(next);
  }

  async complete(input) {
    requireDependencies(this);
    let record = await this.readRecord(input.uploadId);
    if (record.state.phase === 'completed') return publicResult(record);
    record = await this.startCompletion(record);
    record = await this.finishObject(record);
    record = await this.publishMetadata(record);
    record = await this.consumeQuota(record);
    return publicResult(record);
  }

  async cancel(input) {
    requireDependencies(this);
    let record = await this.readRecord(input.uploadId);
    if (record.state.phase === 'aborted') return publicResult(record);
    const state = reduceMultipartState({ state: record.state, event: { type: 'ABORT_STARTED' } });
    record = await this.persistState(record, state);
    if (record.state.r2UploadId) {
      await this.r2.resumeMultipartUpload(record.objectKey, record.state.r2UploadId).abort();
    }
    await this.quota.cancel(this.quotaInput(record, 'cancel'));
    return publicResult(await this.persistEvent(record, { type: 'ABORTED' }));
  }

  async cleanupExpired({ now }) {
    requireDependencies(this);
    let record = await this.repository.read();
    if (!record || record.plan.expiresAt > now || record.state.phase === 'completed') {
      return record ? publicResult(record) : null;
    }
    const previousPhase = record.state.phase;
    record = await this.persistEvent(record, { type: 'EXPIRED' });
    await this.cleanupR2(record, previousPhase);
    await this.quota.cancel(this.quotaInput(record, 'cancel'));
    record = await this.persistEvent(record, { type: 'CLEANUP_FINISHED' });
    return publicResult(record);
  }

  async readRecord(uploadId) {
    const record = await this.repository.read();
    if (!record || record.plan.uploadId !== uploadId) throw uploadError('MULTIPART_UPLOAD_NOT_FOUND');
    return record;
  }

  async startCompletion(record) {
    if (record.state.phase !== 'uploading') return record;
    if (record.state.parts.length !== record.plan.totalParts) throw uploadError('MULTIPART_PARTS_INCOMPLETE');
    return this.persistEvent(record, {
      type: 'COMPLETE_STARTED', parts: completionReceipts(record),
    });
  }

  async finishObject(record) {
    if (record.state.phase !== 'completing') return record;
    const object = await reconcileComplete(record, this.r2);
    if (!objectMatches(record, object)) throw uploadError('MULTIPART_OBJECT_CONFLICT');
    return this.persistEvent(record, {
      type: 'OBJECT_COMPLETED', size: object.size, etag: object.etag,
    });
  }

  async publishMetadata(record) {
    if (record.state.phase !== 'publish_pending') return record;
    await this.metadata.publish(metadataRecord(record));
    return this.persistEvent(record, { type: 'METADATA_PUBLISHED' });
  }

  async consumeQuota(record) {
    if (record.state.phase !== 'quota_pending') return record;
    await this.quota.consume(this.quotaInput(record, 'consume'));
    return this.persistEvent(record, { type: 'QUOTA_CONSUMED' });
  }

  quotaInput(record, action) {
    return Object.freeze({
      uploadId: record.plan.uploadId,
      operationId: record.operations[action],
      bytes: record.plan.expectedSize,
    });
  }

  async cleanupR2(record, previousPhase) {
    if (['publish_pending', 'quota_pending', 'completing'].includes(previousPhase)) {
      const object = await this.r2.head(record.objectKey);
      if (object && !objectMatches(record, object)) throw uploadError('MULTIPART_OBJECT_CONFLICT');
      if (object) return this.r2.delete(record.objectKey);
      if (previousPhase !== 'completing') return undefined;
    }
    if (!record.state.r2UploadId) return undefined;
    return this.r2.resumeMultipartUpload(record.objectKey, record.state.r2UploadId).abort();
  }

  async persistEvent(record, event) {
    const state = reduceMultipartState({ state: record.state, event });
    return this.persistState(record, state);
  }

  async persistState(record, state) {
    const next = withState(record, state);
    await this.repository.write(next);
    return next;
  }
}
