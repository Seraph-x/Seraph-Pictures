const INITIAL_PHASE = 'creating';
const FIRST_PART_NUMBER = 1;

function stateError(code = 'MULTIPART_STATE_INVALID') {
  const error = new Error(code);
  error.code = code;
  return error;
}

function requireString(value) {
  if (typeof value !== 'string' || !value) throw stateError();
  return value;
}

function requirePositiveInteger(value) {
  if (!Number.isSafeInteger(value) || value < FIRST_PART_NUMBER) throw stateError();
  return value;
}

function freezeParts(parts) {
  return Object.freeze(parts.map((part) => Object.freeze({ ...part })));
}

function freezeState(state) {
  const next = {
    ...state,
    parts: freezeParts(state.parts),
    completionParts: state.completionParts ? freezeParts(state.completionParts) : null,
    object: state.object ? Object.freeze({ ...state.object }) : null,
  };
  return Object.freeze(next);
}

export function createMultipartState(options) {
  const state = {
    uploadId: requireString(options?.uploadId),
    objectKey: requireString(options?.objectKey),
    owner: requireString(options?.owner),
    visibility: requireString(options?.visibility),
    expectedSize: requirePositiveInteger(options?.expectedSize),
    rootDigest: requireString(options?.rootDigest),
    expiresAt: requirePositiveInteger(options?.expiresAt),
    phase: INITIAL_PHASE,
    r2UploadId: null,
    parts: [],
    completionParts: null,
    object: null,
  };
  return freezeState(state);
}

function transition(state, changes) {
  return freezeState({ ...state, ...changes });
}

function samePart(left, right) {
  return left.partNumber === right.partNumber
    && left.size === right.size
    && left.digest === right.digest
    && left.etag === right.etag;
}

function readPart(event) {
  return Object.freeze({
    partNumber: requirePositiveInteger(event.partNumber),
    size: requirePositiveInteger(event.size),
    digest: requireString(event.digest),
    etag: requireString(event.etag),
  });
}

function uploadPart(state, event) {
  if (state.phase !== 'uploading') throw stateError();
  const part = readPart(event);
  const existing = state.parts.find((item) => item.partNumber === part.partNumber);
  if (existing && samePart(existing, part)) return state;
  if (existing) throw stateError('MULTIPART_PART_CONFLICT');
  const parts = [...state.parts, part].sort((left, right) => left.partNumber - right.partNumber);
  return transition(state, { parts });
}

function normalizeReceipts(parts) {
  if (!Array.isArray(parts) || !parts.length) throw stateError();
  const receipts = parts.map((part) => ({
    partNumber: requirePositiveInteger(part?.partNumber),
    etag: requireString(part?.etag),
  }));
  const ordered = [...receipts].sort((left, right) => left.partNumber - right.partNumber);
  if (ordered.some((part, index) => part.partNumber !== index + FIRST_PART_NUMBER)) throw stateError();
  return ordered;
}

function sameReceipts(left, right) {
  return left.length === right.length && left.every((part, index) => (
    part.partNumber === right[index].partNumber && part.etag === right[index].etag
  ));
}

function startComplete(state, event) {
  const receipts = normalizeReceipts(event.parts);
  if (state.phase === 'completing') {
    if (sameReceipts(state.completionParts, receipts)) return state;
    throw stateError();
  }
  if (state.phase !== 'uploading' || receipts.length !== state.parts.length) throw stateError();
  const matches = receipts.every((receipt, index) => sameReceiptToPart(receipt, state.parts[index]));
  if (!matches) throw stateError();
  return transition(state, { phase: 'completing', completionParts: receipts });
}

function sameReceiptToPart(receipt, part) {
  return receipt.partNumber === part.partNumber && receipt.etag === part.etag;
}

function createR2Upload(state, event) {
  const r2UploadId = requireString(event.r2UploadId);
  if (state.phase === 'uploading' && state.r2UploadId === r2UploadId) return state;
  if (state.phase !== INITIAL_PHASE) throw stateError();
  return transition(state, { phase: 'uploading', r2UploadId });
}

function completeObject(state, event) {
  const object = Object.freeze({
    size: requirePositiveInteger(event.size),
    etag: requireString(event.etag),
  });
  if (state.phase === 'publish_pending') {
    if (state.object.size === object.size && state.object.etag === object.etag) return state;
    throw stateError();
  }
  if (state.phase !== 'completing') throw stateError();
  return transition(state, { phase: 'publish_pending', object });
}

function advance(state, expected, next) {
  if (state.phase === next) return state;
  if (state.phase !== expected) throw stateError();
  return transition(state, { phase: next });
}

function startAbort(state) {
  if (state.phase === 'aborting') return state;
  if (![INITIAL_PHASE, 'uploading'].includes(state.phase)) throw stateError();
  return transition(state, { phase: 'aborting' });
}

function expire(state) {
  if (state.phase === 'cleanup_pending') return state;
  if (['completed', 'aborted'].includes(state.phase)) throw stateError();
  return transition(state, { phase: 'cleanup_pending' });
}

const EVENT_HANDLERS = Object.freeze({
  MULTIPART_CREATED: createR2Upload,
  PART_UPLOADED: uploadPart,
  COMPLETE_STARTED: startComplete,
  OBJECT_COMPLETED: completeObject,
  METADATA_PUBLISHED: (state) => advance(state, 'publish_pending', 'quota_pending'),
  QUOTA_CONSUMED: (state) => advance(state, 'quota_pending', 'completed'),
  ABORT_STARTED: startAbort,
  ABORTED: (state) => advance(state, 'aborting', 'aborted'),
  EXPIRED: expire,
  CLEANUP_FINISHED: (state) => advance(state, 'cleanup_pending', 'aborted'),
});

export function reduceMultipartState(options) {
  const { state, event } = options ?? {};
  if (!state || !event || typeof event !== 'object') throw stateError();
  const handler = EVENT_HANDLERS[event.type];
  if (!handler) throw stateError();
  return handler(state, event);
}
