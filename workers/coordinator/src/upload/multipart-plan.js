const MIB = 1024 * 1024;
export const MIN_PART_SIZE = 5 * MIB;
export const MAX_PART_SIZE = (5 * 1024 * MIB) - MIN_PART_SIZE;
export const MAX_PARTS = 10_000;
const VISIBILITIES = new Set(['public', 'private']);

function planError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function requireString(value) {
  if (typeof value !== 'string' || !value) throw planError('MULTIPART_PLAN_INVALID');
  return value;
}

function requireInteger(value) {
  if (!Number.isSafeInteger(value) || value <= 0) throw planError('MULTIPART_PLAN_INVALID');
  return value;
}

export function validateMultipartPlan(input) {
  const expectedSize = requireInteger(input?.expectedSize);
  const partSize = requireInteger(input?.partSize);
  const totalParts = requireInteger(input?.totalParts);
  if (totalParts > MAX_PARTS || partSize > MAX_PART_SIZE) throw planError('MULTIPART_PLAN_INVALID');
  if (totalParts > 1 && partSize < MIN_PART_SIZE) throw planError('MULTIPART_PART_TOO_SMALL');
  if (Math.ceil(expectedSize / partSize) !== totalParts) throw planError('MULTIPART_PLAN_INVALID');
  if (!VISIBILITIES.has(input.visibility)) throw planError('MULTIPART_PLAN_INVALID');
  return Object.freeze({
    expectedSize,
    partSize,
    totalParts,
    uploadId: requireString(input.uploadId),
    owner: requireString(input.owner),
    visibility: input.visibility,
    rootDigest: requireString(input.rootDigest),
    fileName: requireString(input.fileName),
    fileType: requireString(input.fileType),
    folderPath: String(input.folderPath || ''),
    createdAt: requireInteger(input.createdAt),
    expiresAt: requireInteger(input.expiresAt),
  });
}

export function expectedPartLength(plan, partNumber) {
  if (!Number.isSafeInteger(partNumber) || partNumber < 1 || partNumber > plan.totalParts) {
    throw planError('MULTIPART_PART_NUMBER_INVALID');
  }
  if (partNumber < plan.totalParts) return plan.partSize;
  return plan.expectedSize - (plan.partSize * (plan.totalParts - 1));
}
