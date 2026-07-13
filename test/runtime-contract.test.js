const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { Hono } = require('hono');

const { decideDockerFileAccess } = require('../server/lib/services/file-access-service');
const { createShareSignature } = require('../server/lib/utils/share-link');
const { registerFileRoutes } = require('../server/routes/files');

const CHANGED_PRODUCTION_FILES = Object.freeze([
  'shared/security/file-metadata.cjs',
  'functions/_middleware.js',
  'functions/api/v1/upload.js',
  'functions/api/manage/visibility/[id].js',
  'functions/services/api-upload-metadata.js',
  'functions/file/[id].js',
  'functions/services/file-access.js',
  'functions/services/file-delivery.js',
  'functions/services/file-delivery/common.js',
  'functions/services/file-delivery/legacy-share.js',
  'functions/services/file-delivery/r2.js',
  'functions/services/file-delivery/remote.js',
  'functions/services/file-delivery/telegram.js',
  'server/lib/repos/visibility-file-repo.js',
  'server/lib/container.js',
  'server/lib/services/file-access-service.js',
  'server/lib/services/chunk-service.js',
  'server/lib/services/upload-service.js',
  'server/lib/utils/share-link.js',
  'server/app.js',
  'server/db/schema.sql',
  'server/routes/files.js',
  'server/routes/visibility.js',
  'server/routes/upload.js',
  'server/routes/upload-chunks.js',
  'server/routes/upload-direct.js',
  'server/routes/upload-remote.js',
]);

function fileRecord(visibility, accessVersion = 1) {
  return Object.freeze({
    metadata: Object.freeze({ visibility, uploadSource: 'drive', accessVersion }),
  });
}

function authService(authenticated) {
  return Object.freeze({
    checkAuthentication() { return Object.freeze({ authenticated }); },
  });
}

describe('visibility runtime contract', function () {
  it('conceals private Docker files from anonymous requests', function () {
    const decision = decideDockerFileAccess({
      file: fileRecord('private'),
      request: new Request('https://vault.example/file/secret'),
      authService: authService(false),
    });

    assert.deepStrictEqual(decision, {
      allowed: false, conceal: true, code: 'FILE_ACCESS_DENIED',
    });
  });

  it('allows administrators to read private Docker files', function () {
    const decision = decideDockerFileAccess({
      file: fileRecord('private'),
      request: new Request('https://vault.example/file/secret'),
      authService: authService(true),
    });

    assert.strictEqual(decision.allowed, true);
  });

  it('rejects Docker share links from a stale access version', async function () {
    const app = new Hono();
    const file = fileRecord('private', 2);
    const services = {
      fileRepo: { getById() { return file; } },
      authService: authService(false),
      uploadService: { async getFileResponse() { throw new Error('must not download'); } },
    };
    registerFileRoutes(app, { config: { sessionSecret: 'secret' } }, {
      getServices() { return services; },
    });
    const expiresAt = Date.now() + 60_000;
    const signature = createShareSignature({
      fileId: 'secret', expiresAt, accessVersion: 1, secret: 'secret',
    });
    const response = await app.request(
      `/share/secret?exp=${expiresAt}&av=1&sig=${encodeURIComponent(signature)}`,
    );

    assert.strictEqual(response.status, 404);
  });

  it('keeps every changed production module within the file-size limit', function () {
    for (const relativePath of CHANGED_PRODUCTION_FILES) {
      const source = fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
      const lineCount = source.split(/\r?\n/).length;
      assert.ok(lineCount <= 300, `${relativePath} has ${lineCount} lines`);
    }
  });
});
