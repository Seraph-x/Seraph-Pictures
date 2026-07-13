'use strict';

const MIB = 1024 * 1024;
const DIRECT_THRESHOLD_BYTES = 20 * MIB;
const DEFAULT_MAX_BYTES = 100 * MIB;
const TELEGRAM_BOT_MAX_BYTES = 50 * MIB;
const DISCORD_MAX_BYTES = 25 * MIB;
const HUGGINGFACE_MAX_BYTES = 35 * MIB;

class StorageCapabilityError extends Error {
  constructor(code, status) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

const DEFINITIONS = Object.freeze({
  telegram: Object.freeze({ streaming: false }),
  r2: Object.freeze({ streaming: true }),
  s3: Object.freeze({ streaming: true }),
  discord: Object.freeze({ streaming: false }),
  huggingface: Object.freeze({ streaming: false }),
  webdav: Object.freeze({ streaming: true }),
  github: Object.freeze({ streaming: false }),
});

function boundedMaximum(value, upper) {
  if (!Number.isSafeInteger(value) || value <= 0) return upper;
  return Math.min(value, upper);
}

function maximumFor(options) {
  const configured = boundedMaximum(options.adminMaxBytes, DEFAULT_MAX_BYTES);
  if (options.type === 'telegram') {
    if (options.audience === 'guest' || options.runtime === 'cloudflare') return DIRECT_THRESHOLD_BYTES;
    return boundedMaximum(configured, TELEGRAM_BOT_MAX_BYTES);
  }
  if (options.type === 'discord') return boundedMaximum(configured, DISCORD_MAX_BYTES);
  if (options.type === 'huggingface') return boundedMaximum(configured, HUGGINGFACE_MAX_BYTES);
  return configured;
}

function modesFor(options) {
  if (options.audience === 'guest') return ['direct'];
  if (options.runtime === 'cloudflare' && options.type === 'r2') return ['direct', 'multipart'];
  if (options.runtime === 'docker') return ['direct', 'chunked'];
  if (!DEFINITIONS[options.type].streaming) return ['direct'];
  return ['direct', 'streaming'];
}

function assertOptions(options) {
  if (!['cloudflare', 'docker'].includes(options?.runtime)) {
    throw new StorageCapabilityError('STORAGE_RUNTIME_UNSUPPORTED', 400);
  }
  if (!DEFINITIONS[options.type]) {
    throw new StorageCapabilityError('STORAGE_BACKEND_UNSUPPORTED', 400);
  }
}

function resolveCapability(options) {
  assertOptions(options);
  const definition = DEFINITIONS[options.type];
  return Object.freeze({
    type: options.type,
    maxBytes: maximumFor(options),
    directThreshold: DIRECT_THRESHOLD_BYTES,
    modes: Object.freeze(modesFor(options)),
    streaming: definition.streaming,
  });
}

function validateUploadMode(options) {
  const capability = resolveCapability(options);
  if (!capability.modes.includes(options.mode)) {
    throw new StorageCapabilityError('STORAGE_UPLOAD_MODE_UNSUPPORTED', 400);
  }
  return capability;
}

function validateUploadCapability(options) {
  const capability = validateUploadMode(options);
  if (!Number.isSafeInteger(options.fileSize) || options.fileSize <= 0) {
    throw new StorageCapabilityError('STORAGE_FILE_SIZE_INVALID', 400);
  }
  if (options.fileSize > capability.maxBytes) {
    throw new StorageCapabilityError('STORAGE_FILE_TOO_LARGE', 413);
  }
  return capability;
}

module.exports = Object.freeze({
  DIRECT_THRESHOLD_BYTES,
  DEFAULT_MAX_BYTES,
  StorageCapabilityError,
  resolveCapability,
  validateUploadMode,
  validateUploadCapability,
});
