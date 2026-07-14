import { reduceMultipartState } from './state-machine.js';
import { sha256Hex } from './digest.js';
import { expectedPartLength, validateMultipartPlan } from './multipart-plan.js';
import { createUploadRecord, withState } from './upload-record.js';
import { multipartMetadataRecord, publicUploadResult } from './record-view.js';

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
    [service.references, [
      'reserve', 'commitStart', 'commitFinish', 'releaseStart', 'releaseFinish',
    ]],
    [service.alarms, ['schedule']],
  ];
  const invalid = requirements.some(([dependency, methods]) => (
    !dependency || methods.some((method) => typeof dependency[method] !== 'function')
  ));
  if (invalid) throw uploadError('MULTIPART_BINDING_MISSING');
}

function samePlan(left, right) {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key) => left[key] === right[key]);
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
    && metadata.expectedSize === String(record.plan.expectedSize)
    && metadata.storageConfigId === record.plan.storageConfigId
    && metadata.storageGeneration === record.plan.storageGeneration;
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
    this.references = dependencies.references;
    this.alarms = dependencies.alarms;
  }

  async initialize(input) {
    requireDependencies(this);
    const plan = validateMultipartPlan(input);
    let record = await this.repository.read();
    if (record && !samePlan(record.plan, plan)) throw uploadError('MULTIPART_PLAN_CONFLICT');
    if (record && record.state.phase !== 'creating') return publicUploadResult(record);
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
    await this.references.reserve({
      operationId: record.operations.reference,
      storageId: record.plan.storageConfigId,
      expiresAt: record.plan.expiresAt,
    });
    await this.references.commitStart({ operationId: record.operations.reference });
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
    return publicUploadResult(withState(record, state));
  }

  async uploadPart(input) {
    requireDependencies(this);
    const record = await this.readRecord(input.uploadId);
    const expected = expectedPartLength(record.plan, input.partNumber);
    if (byteLength(input.bytes) !== expected) throw uploadError('MULTIPART_PART_LENGTH_INVALID');
    const actualDigest = await sha256Hex(input.bytes);
    if (actualDigest !== input.digest) throw uploadError('MULTIPART_DIGEST_MISMATCH');
    const existing = findPart(record, input.partNumber);
    if (existing) { assertExistingPart(existing, input); return publicUploadResult(record); }
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
    return publicUploadResult(next);
  }

  async complete(input) {
    requireDependencies(this);
    let record = await this.readRecord(input.uploadId);
    if (record.state.phase === 'completed') return publicUploadResult(record);
    record = await this.startCompletion(record);
    record = await this.finishObject(record);
    record = await this.publishMetadata(record);
    record = await this.consumeQuota(record);
    return publicUploadResult(record);
  }

  async cancel(input) {
    requireDependencies(this);
    let record = await this.readRecord(input.uploadId);
    if (record.state.phase === 'aborted') return publicUploadResult(record);
    if (!['creating', 'uploading', 'aborting'].includes(record.state.phase)) {
      throw uploadError('MULTIPART_CANCEL_INVALID');
    }
    await this.references.releaseStart({ operationId: record.operations.reference });
    const state = reduceMultipartState({ state: record.state, event: { type: 'ABORT_STARTED' } });
    record = await this.persistState(record, state);
    if (record.state.r2UploadId) {
      await this.r2.resumeMultipartUpload(record.objectKey, record.state.r2UploadId).abort();
    }
    await this.quota.cancel(this.quotaInput(record, 'cancel'));
    record = await this.persistEvent(record, { type: 'ABORTED' });
    await this.references.releaseFinish({ operationId: record.operations.reference });
    return publicUploadResult(record);
  }

  async cleanupExpired({ now }) {
    requireDependencies(this);
    let record = await this.repository.read();
    if (!record || record.plan.expiresAt > now || record.state.phase === 'completed') {
      return record ? publicUploadResult(record) : null;
    }
    const previousPhase = record.state.phase;
    await this.references.releaseStart({ operationId: record.operations.reference });
    record = await this.persistEvent(record, { type: 'EXPIRED' });
    await this.cleanupR2(record, previousPhase);
    await this.quota.cancel(this.quotaInput(record, 'cancel'));
    record = await this.persistEvent(record, { type: 'CLEANUP_FINISHED' });
    await this.references.releaseFinish({ operationId: record.operations.reference });
    return publicUploadResult(record);
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
    await this.metadata.publish(multipartMetadataRecord(record));
    await this.references.commitFinish({ operationId: record.operations.reference });
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
    if (['publish_pending', 'quota_pending', 'completing', 'cleanup_pending'].includes(previousPhase)) {
      const object = await this.r2.head(record.objectKey);
      if (object && !objectMatches(record, object)) throw uploadError('MULTIPART_OBJECT_CONFLICT');
      if (object) return this.r2.delete(record.objectKey);
      if (!['completing', 'cleanup_pending'].includes(previousPhase)) return undefined;
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
