class ChunkPolicyError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'ChunkPolicyError';
    this.code = code;
    this.status = status;
  }
}

function requirePositiveSafeInteger(value, code, label) {
  if (Number.isSafeInteger(value) && value > 0) return value;
  throw new ChunkPolicyError(code, `${label} must be a positive safe integer.`);
}

function createChunkPlan({ fileSize, chunkSize, totalChunks }) {
  const safeFileSize = requirePositiveSafeInteger(fileSize, 'INVALID_FILE_SIZE', 'fileSize');
  const safeChunkSize = requirePositiveSafeInteger(chunkSize, 'INVALID_CHUNK_SIZE', 'chunkSize');
  const safeTotalChunks = requirePositiveSafeInteger(
    totalChunks,
    'INVALID_TOTAL_CHUNKS',
    'totalChunks'
  );
  const expectedTotal = Math.ceil(safeFileSize / safeChunkSize);
  if (safeTotalChunks !== expectedTotal) {
    throw new ChunkPolicyError(
      'CHUNK_PLAN_MISMATCH',
      `totalChunks must be ${expectedTotal} for the declared file size.`
    );
  }
  return { fileSize: safeFileSize, chunkSize: safeChunkSize, totalChunks: safeTotalChunks };
}

function validateChunkPart({ plan, chunkIndex, byteLength }) {
  if (!Number.isSafeInteger(chunkIndex) || chunkIndex < 0 || chunkIndex >= plan.totalChunks) {
    throw new ChunkPolicyError('INVALID_CHUNK_INDEX', 'chunkIndex is outside the upload plan.');
  }
  if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
    throw new ChunkPolicyError('INVALID_CHUNK_SIZE', 'Chunk byte length is invalid.');
  }
  const expectedSize = Math.min(plan.chunkSize, plan.fileSize - (chunkIndex * plan.chunkSize));
  if (byteLength !== expectedSize) {
    throw new ChunkPolicyError(
      'INVALID_CHUNK_SIZE',
      `Chunk ${chunkIndex} must contain exactly ${expectedSize} bytes.`
    );
  }
  return { chunkIndex, byteLength, expectedSize };
}

module.exports = {
  ChunkPolicyError,
  createChunkPlan,
  validateChunkPart,
};
