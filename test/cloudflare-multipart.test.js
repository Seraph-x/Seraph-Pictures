const assert = require('node:assert');

class RecordingCoordinator {
  constructor() { this.calls = []; }
  idFromName(value) { this.id = value; return value; }
  get() {
    return { fetch: async (request, init) => {
      const normalized = request instanceof Request ? request : new Request(request, init);
      this.calls.push({ request: normalized, body: await normalized.clone().arrayBuffer() });
      const path = new URL(normalized.url).pathname;
      const data = path.endsWith('/initialize')
        ? { partSize: 5 * 1024 * 1024 }
        : path.endsWith('/complete')
          ? { fileId: 'r2:u1', fileName: 'x.bin', fileSize: 3 }
          : { uploadedParts: 1, phase: 'uploading' };
      return new Response(JSON.stringify({ data }));
    } };
  }
}

function env(binding) {
  return { AUTH_DISABLED: 'true', APP_ENV: 'local', UPLOAD_COORDINATOR: binding };
}

describe('Cloudflare R2 multipart endpoints', function () {
  it('initializes the server plan without writing legacy KV state', async function () {
    const { onRequestPost } = await import('../functions/api/chunked-upload/init.js');
    const binding = new RecordingCoordinator();
    const response = await onRequestPost({
      request: new Request('https://vault.example/api/chunked-upload/init', {
        method: 'POST', body: JSON.stringify({
          fileName: 'x.bin', fileType: 'application/octet-stream', rootDigest: 'a'.repeat(64),
          fileSize: 3, totalChunks: 1, storageMode: 'r2', storageId: 'r2-a',
          visibility: 'private',
          uploadSource: 'drive',
        }),
      }), env: env(binding), data: {
        storageProfileResolver: { resolve: async () => ({
          id: 'r2-a', type: 'r2', generation: 'generation-1',
          config: { adapterMode: 'binding', bindingName: 'R2_BUCKET' },
        }) },
      },
    });
    assert.strictEqual(response.status, 200);
    assert.strictEqual(binding.calls.length, 1);
    const payload = JSON.parse(Buffer.from(binding.calls[0].body).toString());
    assert.strictEqual(payload.expectedSize, 3);
    assert.strictEqual(payload.totalParts, 1);
    assert.strictEqual(payload.rootDigest, 'a'.repeat(64));
    assert.strictEqual(payload.storageConfigId, 'r2-a');
    assert.strictEqual(payload.uploadSource, 'drive');
    assert.strictEqual(payload.visibility, 'private');
  });

  it('forwards exact bytes, one-based part number, and digest', async function () {
    const { onRequestPost } = await import('../functions/api/chunked-upload/chunk.js');
    const binding = new RecordingCoordinator();
    const form = new FormData();
    form.append('uploadId', 'u1'); form.append('chunkIndex', '0');
    form.append('digest', 'part-digest');
    form.append('chunk', new File([Uint8Array.of(1, 2, 3)], 'part'));
    const response = await onRequestPost({
      request: new Request('https://vault.example/api/chunked-upload/chunk', { method: 'POST', body: form }),
      env: env(binding),
    });
    assert.strictEqual(response.status, 200);
    const call = binding.calls[0];
    assert.strictEqual(new URL(call.request.url).searchParams.get('partNumber'), '1');
    assert.strictEqual(call.request.headers.get('X-Part-SHA256'), 'part-digest');
    assert.deepStrictEqual([...new Uint8Array(call.body)], [1, 2, 3]);
  });

  it('delegates complete and cancel exactly once', async function () {
    const complete = await import('../functions/api/chunked-upload/complete.js');
    const cancel = await import('../functions/api/chunked-upload/cancel.js');
    const binding = new RecordingCoordinator();
    const completeResponse = await complete.onRequestPost({
      request: new Request('https://vault.example/api/chunked-upload/complete', {
        method: 'POST', body: JSON.stringify({ uploadId: 'u1' }),
      }), env: env(binding),
    });
    const cancelResponse = await cancel.onRequestDelete({
      request: new Request('https://vault.example/api/chunked-upload/cancel', {
        method: 'DELETE', body: JSON.stringify({ uploadId: 'u1' }),
      }), env: env(binding),
    });
    assert.strictEqual(completeResponse.status, 200);
    assert.strictEqual(cancelResponse.status, 200);
    assert.deepStrictEqual(binding.calls.map((call) => new URL(call.request.url).pathname), [
      '/complete', '/cancel',
    ]);
  });
});
