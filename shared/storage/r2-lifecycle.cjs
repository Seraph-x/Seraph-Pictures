'use strict';

const R2_MULTIPART_LIFECYCLE = Object.freeze({
  bucket: 'k-vault-files',
  name: 'abort-incomplete-uploads',
  prefix: 'multipart/',
  abortMultipartDays: 1,
});

module.exports = Object.freeze({ R2_MULTIPART_LIFECYCLE });
