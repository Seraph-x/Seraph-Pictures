const assert = require('node:assert');

class MemoryKV {
  constructor() {
    this.values = new Map();
    this.listCalls = [];
  }

  async get(key, options) {
    const item = this.values.get(String(key));
    if (!item) return null;
    if (options?.type === 'json') return item.value ? JSON.parse(item.value) : null;
    return item.value;
  }

  async getWithMetadata(key) {
    const item = this.values.get(String(key));
    return item ? { value: item.value, metadata: item.metadata } : null;
  }

  async put(key, value = '', options = {}) {
    this.values.set(String(key), { value: String(value), metadata: options.metadata || null });
  }

  async delete(key) {
    this.values.delete(String(key));
  }

  async list(options = {}) {
    this.listCalls.push({ ...options });
    const keys = [...this.values.entries()]
      .filter(([key]) => !options.prefix || key.startsWith(options.prefix))
      .sort(([left], [right]) => left.localeCompare(right));
    const offset = Number(options.cursor || 0);
    const limit = Number(options.limit || 1000);
    const page = keys.slice(offset, offset + limit);
    const next = offset + page.length;
    return {
      keys: page.map(([name, item]) => ({ name, metadata: item.metadata })),
      list_complete: next >= keys.length,
      cursor: next >= keys.length ? undefined : String(next),
    };
  }
}

function coordinator() {
  const stub = Object.freeze({
    async fetch(request) {
      const operation = new URL(request.url).pathname.split('/').pop();
      const data = operation === 'configReadAuthority'
        ? { initialized: false, committedVersion: null, digest: null }
        : { initialized: true, schemaVersion: 1, legacyCleanupRequired: false };
      return Response.json({ data });
    },
  });
  return Object.freeze({ idFromName: () => 'admin-auth', get: () => stub });
}

function environment(overrides = {}) {
  return {
    APP_ENV: 'local', AUTH_DISABLED: 'true', img_url: new MemoryKV(),
    AUTH_COORDINATOR: coordinator(),
    ...overrides,
  };
}

function context(url, env, options = {}) {
  return {
    request: new Request(`https://vault.example${url}`, {
      method: options.method || 'GET',
      headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
      body: options.body ? JSON.stringify(options.body) : undefined,
    }),
    env,
    data: {
      storageLifecycle: {
        resolver: { resolve: async () => ({ id: 'telegram-a', type: 'telegram' }) },
        adapterFactory: () => ({}),
        references: {
          releaseStart: async () => {},
          releaseFinish: async () => {},
        },
        backend: { remove: async () => {} },
        metadata: {
          remove: async ({ record }) => {
            await env.img_url.delete(record.fileId);
            return { deleted: true };
          },
        },
      },
    },
  };
}

async function json(response, status = 200) {
  assert.strictEqual(response.status, status);
  return response.json();
}

async function seedFile(kv, id, metadata) {
  await kv.put(id, '', { metadata: {
    fileName: `${id}.jpg`, fileSize: 10, mimeType: 'image/jpeg',
    storageType: 'telegram', folderPath: '', visibility: 'private',
    TimeStamp: 100, ...metadata,
  } });
}

describe('Cloudflare Drive API routes', function () {
  let routes;

  before(async function () {
    routes = {
      tree: await import('../functions/api/drive/tree.js'),
      explorer: await import('../functions/api/drive/explorer.js'),
      folders: await import('../functions/api/drive/folders.js'),
      moveFolder: await import('../functions/api/drive/folders/move.js'),
      moveFiles: await import('../functions/api/drive/files/move.js'),
      renameFile: await import('../functions/api/drive/files/rename.js'),
      deleteFiles: await import('../functions/api/drive/files/delete-batch.js'),
    };
  });

  it('requires administrator authentication on every Drive route', async function () {
    const env = environment({ AUTH_DISABLED: undefined });
    const calls = [
      () => routes.tree.onRequestGet(context('/api/drive/tree', env)),
      () => routes.explorer.onRequestGet(context('/api/drive/explorer', env)),
      () => routes.folders.onRequestPost(context('/api/drive/folders', env, { method: 'POST', body: {} })),
      () => routes.folders.onRequestDelete(context('/api/drive/folders?path=x', env, { method: 'DELETE' })),
      () => routes.moveFolder.onRequestPost(context('/api/drive/folders/move', env, { method: 'POST', body: {} })),
      () => routes.moveFiles.onRequestPost(context('/api/drive/files/move', env, { method: 'POST', body: {} })),
      () => routes.renameFile.onRequestPost(context('/api/drive/files/rename', env, { method: 'POST', body: {} })),
      () => routes.deleteFiles.onRequestPost(context('/api/drive/files/delete-batch', env, { method: 'POST', body: {} })),
    ];
    for (const invoke of calls) {
      const response = await invoke();
      assert.strictEqual(response.status, 401);
      assert.strictEqual((await response.json()).error.code, 'AUTH_REQUIRED');
    }
  });

  it('creates explicit folder records and paginates the tree', async function () {
    const env = environment();
    for (const path of ['photos/2026', 'documents']) {
      const created = await json(await routes.folders.onRequestPost(context('/api/drive/folders', env, {
        method: 'POST', body: { path },
      })));
      assert.strictEqual(created.folder.path, path);
    }
    const first = await json(await routes.tree.onRequestGet(context('/api/drive/tree?limit=1', env)));
    assert.strictEqual(first.nodes.length, 1);
    assert.ok(first.nextCursor);
    const second = await json(await routes.tree.onRequestGet(context(
      `/api/drive/tree?limit=10&cursor=${encodeURIComponent(first.nextCursor)}`, env,
    )));
    assert.ok(second.nodes.length >= 1);
    assert.ok([...env.img_url.values.keys()].every((key) => key.startsWith('drive:folder:v1:')));
  });

  it('returns one KV page with folder, visibility, search, and cursor filters', async function () {
    const env = environment();
    await json(await routes.folders.onRequestPost(context('/api/drive/folders', env, {
      method: 'POST', body: { path: 'photos/2026' },
    })));
    await seedFile(env.img_url, 'img:a', {
      fileName: 'alpha.jpg', folderPath: 'photos', visibility: 'private', ListType: 'White',
    });
    await seedFile(env.img_url, 'img:b', { fileName: 'beta.jpg', folderPath: 'photos', visibility: 'public' });
    await seedFile(env.img_url, 'img:c', { fileName: 'alpha-root.jpg', folderPath: '', visibility: 'private' });
    const result = await json(await routes.explorer.onRequestGet(context(
      '/api/drive/explorer?path=photos&visibility=private&search=alpha&listType=white&limit=100&includeStats=1', env,
    )));
    assert.deepStrictEqual(result.files.map((file) => file.name), ['img:a']);
    assert.deepStrictEqual(result.folders.map((folder) => folder.path), ['photos/2026']);
    assert.strictEqual(result.files[0].metadata.visibility, 'private');
    assert.strictEqual(result.stats.files, 1);
    const unprefixedCalls = env.img_url.listCalls.filter((call) => !call.prefix);
    assert.strictEqual(unprefixedCalls.length, 1);
  });

  it('moves folders and files, then renames files with strict paths', async function () {
    const env = environment();
    await seedFile(env.img_url, 'img:a', { folderPath: 'photos/2026' });
    await json(await routes.folders.onRequestPost(context('/api/drive/folders', env, {
      method: 'POST', body: { path: 'photos/2026' },
    })));
    const movedFolder = await json(await routes.moveFolder.onRequestPost(context('/api/drive/folders/move', env, {
      method: 'POST', body: { sourcePath: 'photos', targetPath: 'archive' },
    })));
    assert.strictEqual(movedFolder.updatedFiles, 1);
    assert.strictEqual((await env.img_url.getWithMetadata('img:a')).metadata.folderPath, 'archive/2026');

    const movedFiles = await json(await routes.moveFiles.onRequestPost(context('/api/drive/files/move', env, {
      method: 'POST', body: { ids: ['img:a'], targetFolderPath: 'featured' },
    })));
    assert.strictEqual(movedFiles.moved, 1);
    const renamed = await json(await routes.renameFile.onRequestPost(context('/api/drive/files/rename', env, {
      method: 'POST', body: { id: 'img:a', fileName: 'renamed.jpg' },
    })));
    assert.strictEqual(renamed.file.fileName, 'renamed.jpg');
    const invalid = await json(await routes.moveFiles.onRequestPost(context('/api/drive/files/move', env, {
      method: 'POST', body: { ids: ['img:a'], targetFolderPath: '../private' },
    })), 400);
    assert.strictEqual(invalid.error.code, 'DRIVE_PATH_INVALID');
  });

  it('requires recursive authorization and deletes files in recursive folders', async function () {
    const env = environment();
    await seedFile(env.img_url, 'img:a', { folderPath: 'photos' });
    await json(await routes.folders.onRequestPost(context('/api/drive/folders', env, {
      method: 'POST', body: { path: 'photos' },
    })));
    const conflict = await json(await routes.folders.onRequestDelete(context(
      '/api/drive/folders?path=photos', env, { method: 'DELETE' },
    )), 409);
    assert.strictEqual(conflict.error.code, 'DRIVE_FOLDER_NOT_EMPTY');
    const deleted = await json(await routes.folders.onRequestDelete(context(
      '/api/drive/folders?path=photos&recursive=1', env, { method: 'DELETE' },
    )));
    assert.strictEqual(deleted.deletedFiles, 1);
    assert.strictEqual(await env.img_url.getWithMetadata('img:a'), null);
  });

  it('deletes file batches and reports missing IDs explicitly', async function () {
    const env = environment();
    await seedFile(env.img_url, 'img:a', {});
    const result = await json(await routes.deleteFiles.onRequestPost(context('/api/drive/files/delete-batch', env, {
      method: 'POST', body: { ids: ['img:a', 'missing'] },
    })));
    assert.deepStrictEqual(result, {
      success: true, requested: 2, deleted: 1, notFound: ['missing'], failed: [],
    });
  });
});
