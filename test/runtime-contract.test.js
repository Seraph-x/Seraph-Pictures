const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { Hono } = require('hono');

const { decideDockerFileAccess } = require('../server/lib/services/file-access-service');
const { createShareSignature } = require('../server/lib/utils/share-link');
const { registerShareRoutes } = require('../server/routes/shares');
const { registerFileRoutes } = require('../server/routes/files');
const { createSignedTelegramFileId } = require('../server/lib/utils/telegram-webhook');

const CHANGED_PRODUCTION_FILES = Object.freeze([
  'shared/security/file-metadata.cjs',
  'shared/security/share-policy.cjs',
  'shared/security/range-lease.cjs',
  'functions/_middleware.js',
  'functions/api/v1/upload.js',
  'functions/api/manage/visibility/[id].js',
  'functions/api/share/sign.js',
  'functions/api/share/revoke/[id].js',
  'functions/services/api-upload-metadata.js',
  'functions/file/[id].js',
  'functions/services/file-access.js',
  'functions/services/share-access.js',
  'functions/services/file-delivery.js',
  'functions/services/file-delivery/common.js',
  'functions/services/file-delivery/legacy-share.js',
  'functions/services/file-delivery/r2.js',
  'functions/services/file-delivery/remote.js',
  'functions/services/file-delivery/telegram.js',
  'server/lib/repos/visibility-file-repo.js',
  'server/lib/repos/share-repo.js',
  'server/lib/container.js',
  'server/lib/config/share-config.js',
  'server/lib/services/file-access-service.js',
  'server/lib/services/chunk-service.js',
  'server/lib/services/upload-service.js',
  'server/lib/services/share-service.js',
  'server/lib/utils/share-link.js',
  'server/app.js',
  'server/db/schema.sql',
  'server/db/index.js',
  'server/routes/files.js',
  'server/routes/shares.js',
  'server/routes/telegram.js',
  'server/routes/telegram-webhook.js',
  'scripts/bootstrap-env.js',
  'server/routes/visibility.js',
  'server/routes/upload.js',
  'server/routes/upload-chunks.js',
  'server/routes/upload-direct.js',
  'server/routes/upload-remote.js',
  'functions/s/[slug].js',
  'functions/utils/auth/coordinator-client.js',
  'functions/utils/auth/operation-contracts.js',
  'workers/coordinator/src/auth/auth-coordinator.js',
  'workers/coordinator/src/share/share-coordinator.js',
  'workers/coordinator/src/share/share-repository.js',
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
    registerShareRoutes(app, { config: { sessionSecret: 'secret' } }, {
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

  it('conceals private Docker files reached through signed Telegram ids', async function () {
    const app = new Hono();
    const signedId = createSignedTelegramFileId({
      fileId: 'telegram-file', fileExtension: 'png', fileName: 'private.png',
    }, { FILE_URL_SECRET: 'file-secret' });
    const services = {
      fileRepo: {
        getById(id) { return id === 'telegram-file.png' ? fileRecord('private') : null; },
      },
      authService: authService(false),
      storageRepo: {},
    };
    registerFileRoutes(app, { config: { configEncryptionKey: 'file-secret' } }, {
      getServices() { return services; },
    });
    const response = await app.request(`/file/${encodeURIComponent(signedId)}`);

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
