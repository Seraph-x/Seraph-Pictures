const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { createApp } = require('../server/app');
const { createContainer } = require('../server/lib/container');

const APP_HEADERS = Object.freeze({
  Accept: 'application/vnd.seraph.v2+json',
  'X-Seraph-Client': 'app-v2',
});

function request(url, options = {}) {
  const headers = new Headers(APP_HEADERS);
  if (options.body) headers.set('Content-Type', 'application/json');
  return new Request(`http://localhost${url}`, {
    method: options.method || 'GET', headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
}

async function json(response, status = 200) {
  assert.strictEqual(response.status, status);
  return response.json();
}

describe('Docker Storage and Drive shared runtime contract', function () {
  const originalEnv = { ...process.env };
  let tempDir;

  beforeEach(function () {
    tempDir = path.join(__dirname, '..', 'data', `tmp-runtime-contract-${Date.now()}-${Math.random()}`);
    fs.mkdirSync(tempDir, { recursive: true });
    Object.assign(process.env, {
      NODE_ENV: 'test', AUTH_DISABLED: 'true', DATA_DIR: tempDir,
      DB_PATH: path.join(tempDir, 'runtime.db'), SETTINGS_STORE: 'sqlite',
      CONFIG_ENCRYPTION_KEY: 'runtime-contract-encryption-key',
      SESSION_SECRET: 'runtime-contract-session-secret',
      TG_BOT_TOKEN: '', TG_CHAT_ID: '',
    });
  });

  afterEach(function () {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
  });

  it('matches Storage envelopes and preserves blank secrets', async function () {
    const app = createApp();
    const created = await json(await app.fetch(request('/api/storage', {
      method: 'POST',
      body: { name: 'Telegram', type: 'telegram', config: { botToken: 'secret', chatId: 'chat' } },
    })));
    assert.strictEqual(created.item.config.botToken, '********');

    const updated = await json(await app.fetch(request(`/api/storage/${created.item.id}`, {
      method: 'PUT', body: { name: 'Updated', config: { botToken: '', chatId: 'next-chat' } },
    })));
    assert.strictEqual(updated.item.config.botToken, '********');
    assert.strictEqual(updated.item.config.chatId, 'next-chat');

    const listed = await json(await app.fetch(request('/api/storage/list')));
    assert.deepStrictEqual(listed.items.map((item) => item.id), [created.item.id]);

    const secondary = await json(await app.fetch(request('/api/storage', {
      method: 'POST',
      body: { name: 'Secondary', type: 'telegram', config: { botToken: 'next', chatId: 'other' } },
    })));
    const selected = await json(await app.fetch(request(`/api/storage/default/${secondary.item.id}`, {
      method: 'POST',
    })));
    assert.strictEqual(selected.item.isDefault, true);
    assert.deepStrictEqual(await json(await app.fetch(request(`/api/storage/${created.item.id}`, {
      method: 'DELETE',
    }))), { success: true });

    const invalid = await json(await app.fetch(request('/api/storage', {
      method: 'POST', body: { name: '', type: 'telegram', config: {} },
    })), 400);
    assert.strictEqual(invalid.error.code, 'STORAGE_NAME_REQUIRED');
    const afterInvalid = await json(await app.fetch(request('/api/storage/list')));
    assert.deepStrictEqual(afterInvalid.items.map((item) => item.id), [secondary.item.id]);

    const unsupported = await json(await app.fetch(request('/api/storage', {
      method: 'POST', body: { name: 'Unknown', type: 'unknown', config: {} },
    })), 400);
    assert.strictEqual(unsupported.error.code, 'STORAGE_BACKEND_UNSUPPORTED');
  });

  it('matches Drive visibility, path, and cursor semantics', async function () {
    const container = createContainer(process.env);
    const storage = container.storageRepo.create({
      name: 'Files', type: 'telegram', config: { botToken: 'token', chatId: 'chat' },
    });
    for (const [id, visibility] of [['private-file', 'private'], ['public-file', 'public']]) {
      container.fileRepo.create({
        id, storageConfigId: storage.id, storageType: 'telegram', storageKey: id,
        fileName: `${id}.jpg`, fileSize: 10, mimeType: 'image/jpeg', folderPath: 'photos',
        visibility, uploadSource: visibility === 'private' ? 'drive' : 'image-host', accessVersion: 1,
      });
    }
    const archive = container.storageRepo.create({
      name: 'Archive', type: 'telegram', config: { botToken: 'archive', chatId: 'archive' },
    });
    container.fileRepo.create({
      id: 'archive-file', storageConfigId: archive.id, storageType: archive.type,
      storageKey: 'archive-file', fileName: 'archive.jpg', fileSize: 10,
      mimeType: 'image/jpeg', folderPath: 'photos', visibility: 'public',
      uploadSource: 'image-host', accessVersion: 1,
    });
    container.fileRepo.createFolder('documents');
    const app = createApp();
    const explorer = await json(await app.fetch(request(
      '/api/drive/explorer?path=photos&visibility=private&limit=100&includeStats=1',
    )));
    assert.deepStrictEqual(explorer.files.map((file) => file.name), ['private-file']);
    assert.strictEqual(explorer.files[0].metadata.visibility, 'private');
    assert.strictEqual(explorer.currentPath, 'photos');
    assert.ok(Array.isArray(explorer.breadcrumbs));

    const exactProfile = await json(await app.fetch(request(
      `/api/drive/explorer?path=photos&visibility=public&storageId=${archive.id}`,
    )));
    assert.deepStrictEqual(exactProfile.files.map((file) => file.name), ['archive-file']);
    assert.strictEqual(exactProfile.files[0].metadata.storageName, 'Archive');

    const tree = await json(await app.fetch(request('/api/drive/tree?limit=1')));
    assert.strictEqual(tree.nodes.length, 1);
    assert.strictEqual(typeof tree.list_complete, 'boolean');

    const folder = await json(await app.fetch(request('/api/drive/folders', {
      method: 'POST', body: { path: 'documents/archive' },
    })));
    assert.strictEqual(folder.folder.path, 'documents/archive');
    const movedFolder = await json(await app.fetch(request('/api/drive/folders/move', {
      method: 'POST', body: { sourcePath: 'documents/archive', targetPath: 'archive' },
    })));
    assert.strictEqual(movedFolder.targetPath, 'archive');

    const movedFiles = await json(await app.fetch(request('/api/drive/files/move', {
      method: 'POST', body: { ids: ['private-file'], targetFolderPath: 'archive' },
    })));
    assert.strictEqual(movedFiles.moved, 1);
    const renamed = await json(await app.fetch(request('/api/drive/files/rename', {
      method: 'POST', body: { id: 'private-file', fileName: 'renamed.jpg' },
    })));
    assert.deepStrictEqual(renamed.file, { id: 'private-file', fileName: 'renamed.jpg' });

    const conflict = await json(await app.fetch(request('/api/drive/folders?path=archive', {
      method: 'DELETE',
    })), 409);
    assert.strictEqual(conflict.error.code, 'DRIVE_FOLDER_NOT_EMPTY');
    const batch = await json(await app.fetch(request('/api/drive/files/delete-batch', {
      method: 'POST', body: { ids: ['missing-file'] },
    })));
    assert.deepStrictEqual(batch.notFound, ['missing-file']);

    const traversal = await json(await app.fetch(request('/api/drive/files/move', {
      method: 'POST', body: { ids: ['private-file'], targetFolderPath: '../private' },
    })), 400);
    assert.strictEqual(traversal.error.code, 'DRIVE_PATH_INVALID');
  });

  it('routes canonical, batch, and migration lifecycle operations through exact profiles', async function () {
    const container = createContainer(process.env);
    const source = container.storageRepo.create({
      name: 'Source', type: 'telegram', config: { botToken: 'source', chatId: 'source-chat' },
    });
    const destination = container.storageRepo.create({
      name: 'Destination', type: 'telegram', config: { botToken: 'destination', chatId: 'destination-chat' },
    });
    for (const id of ['canonical-file', 'batch-file', 'migration-file']) {
      container.fileRepo.create({
        id, storageConfigId: source.id, storageType: source.type, storageKey: `${id}-key`,
        fileName: `${id}.jpg`, fileSize: 4, mimeType: 'image/jpeg', visibility: 'private',
        uploadSource: 'drive', accessVersion: 1, extra: { telegramMessageId: 42 },
      });
    }
    const events = [];
    container.storageFactory.createAdapter = (profile) => {
      if (profile.id === source.id) return {
        download: async () => new Response(new Uint8Array([1, 2, 3, 4])),
        delete: async ({ operationId }) => { events.push(['delete', operationId]); return true; },
      };
      return {
        upload: async ({ operationId }) => {
          events.push(['upload', operationId]);
          return { storageKey: 'migrated-key', metadata: { telegramFileId: 'migrated-key' } };
        },
      };
    };
    const app = createApp({ container });

    const canonical = await json(await app.fetch(request('/api/manage/delete/canonical-file', {
      method: 'DELETE',
    })));
    assert.strictEqual(canonical.fileId, 'canonical-file');
    const batch = await json(await app.fetch(request('/api/drive/files/delete-batch', {
      method: 'POST', body: { ids: ['batch-file'] },
    })));
    assert.strictEqual(batch.deleted, 1);
    const migrated = await json(await app.fetch(request('/api/drive/files/migrate', {
      method: 'POST',
      body: { fileIds: ['migration-file'], destinationStorageId: destination.id },
    })));
    assert.strictEqual(migrated.results[0].storageId, destination.id);
    assert.strictEqual(container.fileRepo.getById('migration-file').storage_config_id, destination.id);
    assert.deepStrictEqual(events, [
      ['delete', 'delete:canonical-file'],
      ['delete', 'delete:batch-file'],
      ['upload', `transfer:migration-file:${destination.id}`],
      ['delete', `transfer:migration-file:${destination.id}`],
    ]);
    container.db.close();
  });
});
