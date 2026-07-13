const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { Hono } = require('hono');

const { ShareRepository } = require('../server/lib/repos/share-repo');
const { ShareService } = require('../server/lib/services/share-service');
const { loadShareConfig } = require('../server/lib/config/share-config');
const { registerShareRoutes } = require('../server/routes/shares');
const {
  persistMetadata,
  resolveTelegramConfig,
} = require('../server/routes/telegram-webhook');

const NOW_MS = 1_800_000_000_000;
const CURRENT_SECRET = 'current-secret-with-at-least-32-characters';

function createService(options = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(path.resolve(__dirname, '../server/db/schema.sql'), 'utf8'));
  db.prepare(
    `INSERT INTO storage_configs
     (id, name, type, encrypted_payload, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run('storage-1', 'Storage', 'r2', '{}', NOW_MS, NOW_MS);
  db.prepare(
    `INSERT INTO files(
      id, storage_config_id, storage_type, storage_key, file_name,
      visibility, upload_source, access_version, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    'file-1', 'storage-1', 'r2', 'file-1', 'file.png',
    'private', 'drive', 3, NOW_MS, NOW_MS,
  );
  const service = new ShareService({
    repository: new ShareRepository(db),
    currentSecret: CURRENT_SECRET,
    previousSecret: options.previousSecret,
    previousValidUntil: options.previousValidUntil,
    clock: { now: () => NOW_MS },
    ids: { create: () => 'share-1' },
  });
  return { db, service };
}

describe('Docker private shares', function () {
  it('requires a dedicated share secret in production', function () {
    assert.throws(
      () => loadShareConfig({ env: {}, nodeEnv: 'production' }),
      (error) => error.code === 'INSECURE_PRODUCTION_CONFIG',
    );
    assert.strictEqual(loadShareConfig({
      env: { FILE_SHARE_SECRET_CURRENT: CURRENT_SECRET },
      nodeEnv: 'production',
    }).currentSecret, CURRENT_SECRET);
  });

  it('persists, signs, and atomically consumes a password share', async function () {
    const { db, service } = createService();
    const created = await service.create({
      fileId: 'file-1',
      accessVersion: 3,
      ttlSeconds: 60,
      password: 'secret',
      maxDownloads: 1,
    });
    const envelope = {
      shareId: created.shareId,
      fileId: 'file-1',
      expiresAt: created.expiresAt,
      accessVersion: 3,
      signature: created.signature,
      password: 'secret',
    };

    const first = await service.consume(envelope);
    const second = await service.consume(envelope);

    assert.strictEqual(first.ok, true);
    assert.strictEqual(first.record.downloadCount, 1);
    assert.deepStrictEqual(second, { ok: false, code: 'SHARE_DOWNLOAD_LIMIT' });
    db.close();
  });

  it('invalidates a share after accessVersion changes', async function () {
    const { db, service } = createService();
    const created = await service.create({
      fileId: 'file-1', accessVersion: 3, ttlSeconds: 60,
    });
    const result = await service.consume({
      shareId: created.shareId,
      fileId: 'file-1',
      expiresAt: created.expiresAt,
      accessVersion: 4,
      signature: created.signature,
    });

    assert.deepStrictEqual(result, { ok: false, code: 'SHARE_ENVELOPE_INVALID' });
    db.close();
  });

  it('revokes a share explicitly', async function () {
    const { db, service } = createService();
    const created = await service.create({
      fileId: 'file-1', accessVersion: 3, ttlSeconds: 60,
    });
    assert.deepStrictEqual(service.revoke(created.shareId), { revoked: true });
    const result = await service.consume({
      shareId: created.shareId,
      fileId: 'file-1',
      expiresAt: created.expiresAt,
      accessVersion: 3,
      signature: created.signature,
    });
    assert.deepStrictEqual(result, { ok: false, code: 'SHARE_REVOKED' });
    db.close();
  });

  it('keeps the frontend share API path and serves the signed URL', async function () {
    const { db, service } = createService();
    const app = new Hono();
    const file = {
      id: 'file-1',
      metadata: { visibility: 'private', uploadSource: 'drive', accessVersion: 3 },
    };
    let deliveryFailure = false;
    const services = {
      shareService: service,
      fileRepo: { getById(id) { return id === 'file-1' ? file : null; } },
      uploadService: {
        async getFileResponse(_fileId, range) {
          if (deliveryFailure) throw new Error('storage unavailable');
          const headers = new Headers();
          if (range === 'bytes=0-0') headers.set('Content-Range', 'bytes 0-0/5');
          if (range === 'bytes=1-2') headers.set('Content-Range', 'bytes 1-2/5');
          if (range === 'bytes=3-') headers.set('Content-Range', 'bytes 3-4/5');
          return {
            file: { mime_type: 'image/png' },
            response: new Response(new Uint8Array([7]), {
              status: range ? 206 : 200, headers,
            }),
          };
        },
      },
    };
    const helpers = {
      requireAuth() { return null; },
      getServices() { return services; },
      asString(value) { return String(value || ''); },
      toAbsoluteUrl(context, value) { return new URL(value, context.req.url).toString(); },
      buildFileProxyHeaders(result) { return new Headers(result.response.headers); },
      jsonError(context, status, code) { return context.json({ code }, status); },
    };
    registerShareRoutes(app, { config: { sessionSecret: 'secret' } }, helpers);
    const signed = await app.request('/api/share/sign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileId: 'file-1', ttlSeconds: 60, maxDownloads: 1 }),
    });
    const payload = await signed.json();
    const target = new URL(payload.shareUrl).pathname + new URL(payload.shareUrl).search;
    const inspected = await app.request(target, { method: 'HEAD' });
    assert.strictEqual(inspected.status, 200);
    assert.strictEqual(service.getById(payload.shareId).downloadCount, 0);
    deliveryFailure = true;
    const failed = await app.request(target, { headers: { Range: 'bytes=0-0' } });
    assert.strictEqual(failed.status, 500);
    assert.strictEqual(service.getById(payload.shareId).downloadCount, 0);
    deliveryFailure = false;
    const downloaded = await app.request(target, { headers: { Range: 'bytes=0-0' } });

    assert.strictEqual(signed.status, 200);
    assert.strictEqual(downloaded.status, 206);
    assert.strictEqual(service.getById(payload.shareId).downloadCount, 1);
    const cookie = downloaded.headers.get('set-cookie').split(';')[0];
    const ranged = await app.request(target, {
      headers: { Range: 'bytes=1-2', Cookie: cookie },
    });
    assert.strictEqual(ranged.status, 206);
    assert.strictEqual(service.getById(payload.shareId).downloadCount, 1);
    const replayed = await app.request(target, {
      headers: { Range: 'bytes=1-2', Cookie: cookie },
    });
    assert.strictEqual(replayed.status, 404);
    const nextCookie = ranged.headers.get('set-cookie').split(';')[0];
    const completed = await app.request(target, {
      headers: { Range: 'bytes=3-', Cookie: nextCookie },
    });
    assert.strictEqual(completed.status, 206);
    const repeatedFull = await app.request(target, { headers: { Cookie: cookie } });
    assert.strictEqual(repeatedFull.status, 404);
    assert.strictEqual(service.getById(payload.shareId).downloadCount, 1);
    assert.deepStrictEqual([...new Uint8Array(await downloaded.arrayBuffer())], [7]);
    db.close();
  });

  it('returns the canonical URL for a public file without creating a share', async function () {
    const { db, service } = createService();
    const app = new Hono();
    const services = {
      shareService: service,
      fileRepo: {
        getById() {
          return { id: 'file-1', metadata: { visibility: 'public', accessVersion: 3 } };
        },
      },
    };
    const helpers = {
      requireAuth() { return null; },
      getServices() { return services; },
      asString(value) { return String(value || ''); },
      toAbsoluteUrl(context, value) { return new URL(value, context.req.url).toString(); },
      jsonError(context, status, code) { return context.json({ code }, status); },
    };
    registerShareRoutes(app, { config: {} }, helpers);
    const response = await app.request('/api/share/sign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileId: 'file-1' }),
    });
    const body = await response.json();

    assert.strictEqual(response.status, 200);
    assert.strictEqual(body.permission, 'public-read');
    assert.strictEqual(body.shareUrl, 'http://localhost/file/file-1');
    db.close();
  });

  it('persists webhook files against the real Telegram storage config', function () {
    let created;
    const config = resolveTelegramConfig({ config: {} }, {
      findEnabledByType() {
        return [{
          id: 'telegram-storage',
          config: { botToken: 'token', chatId: 'chat', apiBase: 'https://api.example' },
        }];
      },
    });
    persistMetadata({
      fileRepo: {
        getById() { return null; },
        create(record) { created = record; },
      },
      media: {
        fileId: 'telegram-file', fileExtension: 'png', fileName: 'image.png',
        fileSize: 3, mimeType: 'image/png', messageId: 9,
      },
      config,
      useSigned: true,
    });

    assert.strictEqual(config.storageConfigId, 'telegram-storage');
    assert.strictEqual(created.storageConfigId, 'telegram-storage');
    assert.strictEqual(created.storageKey, 'telegram-file');
  });

  it('surfaces unknown share persistence failures as HTTP 500', async function () {
    const app = new Hono();
    const services = {
      shareService: { create() { throw new Error('disk failure'); } },
      fileRepo: {
        getById() { return { metadata: { visibility: 'private', accessVersion: 1 } }; },
      },
    };
    registerShareRoutes(app, { config: {} }, {
      requireAuth() { return null; },
      getServices() { return services; },
      asString(value) { return String(value || ''); },
    });
    const response = await app.request('/api/share/sign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileId: 'file-1', ttlSeconds: 60 }),
    });

    assert.strictEqual(response.status, 500);
  });
});
