const storageCapabilities = require('../../shared/storage/capabilities.cjs');

const STORAGE_TYPES = Object.freeze([
  'telegram', 'r2', 's3', 'discord', 'huggingface', 'webdav', 'github',
]);

function createUploadCapabilityHelpers(config) {
  function getUploadLimits() {
    return Object.fromEntries(STORAGE_TYPES.map((type) => {
      const capability = storageCapabilities.resolveCapability({
        runtime: 'docker', type, adminMaxBytes: Number(config.uploadMaxSize),
      });
      return [type, {
        maxBytes: capability.maxBytes,
        directThreshold: Number(config.uploadSmallFileThreshold),
        supportsChunkUpload: capability.modes.includes('chunked'),
      }];
    }));
  }

  function validateUploadCapability(options) {
    return storageCapabilities.validateUploadCapability({
      ...options, runtime: 'docker', adminMaxBytes: Number(config.uploadMaxSize),
    });
  }

  return Object.freeze({ getUploadLimits, validateUploadCapability });
}

module.exports = { createUploadCapabilityHelpers };
