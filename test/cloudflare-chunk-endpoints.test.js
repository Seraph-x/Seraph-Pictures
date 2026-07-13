const assert = require('node:assert');

class BinaryKV {
  constructor() {
    this.store = new Map();
  }

  async put(key, value) {
    this.store.set(String(key), value);
  }

  async get(key, options = {}) {
    const value = this.store.get(String(key));
    if (value == null) return null;
    if (options.type === 'json') return JSON.parse(String(value));
    return value;
  }

  async delete(key) {
    this.store.delete(String(key));
  }
}

class MemoryR2 {
  constructor(parts = {}) {
    this.parts = new Map(Object.entries(parts));
  }

  async get(key) {
    const value = this.parts.get(key);
    if (!value) return null;
    return { arrayBuffer: async () => Uint8Array.from(value).buffer };
  }

  async put(key, value) {
    this.parts.set(key, new Uint8Array(value));
  }

  async delete(key) {
    this.parts.delete(key);
  }
}

describe('Cloudflare chunk endpoint boundaries', function () {
  it('rejects an init request with inconsistent totalChunks', async function () {
    const { onRequestPost } = await import('../functions/api/chunked-upload/init.js');
    const response = await onRequestPost({
      request: new Request('https://vault.example/api/chunked-upload/init', {
        method: 'POST',
        body: JSON.stringify({ fileName: 'x.bin', fileSize: 11, totalChunks: 2, storageMode: 'r2' }),
      }),
      env: { AUTH_DISABLED: 'true', APP_ENV: 'local', img_url: new BinaryKV() },
    });

    assert.strictEqual(response.status, 400);
    assert.strictEqual((await response.json()).code, 'CHUNK_PLAN_MISMATCH');
  });

  it('rejects an out-of-range chunk index before persistence', async function () {
    const { onRequestPost } = await import('../functions/api/chunked-upload/chunk.js');
    const kv = new BinaryKV();
    await kv.put('upload:u1', JSON.stringify({
      fileSize: 11,
      totalChunks: 3,
      chunkSize: 5,
      uploadedChunks: [],
      chunkBackend: 'kv',
    }));
    const form = new FormData();
    form.append('uploadId', 'u1');
    form.append('chunkIndex', '3');
    form.append('chunk', new File([Uint8Array.of(1)], 'part'));

    const response = await onRequestPost({
      request: new Request('https://vault.example/api/chunked-upload/chunk', { method: 'POST', body: form }),
      env: { AUTH_DISABLED: 'true', APP_ENV: 'local', img_url: kv },
    });

    assert.strictEqual(response.status, 400);
    assert.strictEqual((await response.json()).code, 'INVALID_CHUNK_INDEX');
    assert.strictEqual(await kv.get('chunk:u1:3'), null);
  });

  it('rejects a missing chunk index instead of treating it as zero', async function () {
    const { onRequestPost } = await import('../functions/api/chunked-upload/chunk.js');
    const kv = new BinaryKV();
    await kv.put('upload:u-missing', JSON.stringify({
      fileSize: 1,
      totalChunks: 1,
      chunkSize: 1,
      uploadedChunks: [],
      chunkBackend: 'kv',
    }));
    const form = new FormData();
    form.append('uploadId', 'u-missing');
    form.append('chunk', new File([Uint8Array.of(1)], 'part'));

    const response = await onRequestPost({
      request: new Request('https://vault.example/api/chunked-upload/chunk', { method: 'POST', body: form }),
      env: { AUTH_DISABLED: 'true', APP_ENV: 'local', img_url: kv },
    });

    assert.strictEqual(response.status, 400);
    assert.strictEqual(await kv.get('chunk:u-missing:0'), null);
  });

  it('rejects an aggregate size mismatch before final storage upload', async function () {
    const { onRequestPost } = await import('../functions/api/chunked-upload/complete.js');
    const kv = new BinaryKV();
    const r2 = new MemoryR2({
      'chunk-upload/u2/0': [1, 2, 3, 4, 5],
      'chunk-upload/u2/1': [6, 7],
    });
    await kv.put('upload:u2', JSON.stringify({
      fileName: 'x.bin',
      fileSize: 6,
      fileType: 'application/octet-stream',
      totalChunks: 2,
      chunkSize: 5,
      storageMode: 'r2',
      chunkBackend: 'r2',
      uploadedChunks: [0, 1],
    }));

    const response = await onRequestPost({
      request: new Request('https://vault.example/api/chunked-upload/complete', {
        method: 'POST',
        body: JSON.stringify({ uploadId: 'u2' }),
      }),
      env: { AUTH_DISABLED: 'true', APP_ENV: 'local', img_url: kv, R2_BUCKET: r2 },
    });

    assert.strictEqual(response.status, 400);
    assert.strictEqual((await response.json()).code, 'INVALID_CHUNK_SIZE');
  });
});
