const assert = require('node:assert');

function coordinator(handler) {
  return {
    idFromName: (value) => value,
    get: () => ({ fetch: handler }),
  };
}

function localEnv(handler = async () => new Response('{}', { status: 500 })) {
  return {
    AUTH_DISABLED: 'true', APP_ENV: 'local',
    UPLOAD_COORDINATOR: coordinator(handler),
  };
}

describe('Cloudflare chunk endpoint boundaries', function () {
  it('rejects an init request with inconsistent totalChunks', async function () {
    const { onRequestPost } = await import('../functions/api/chunked-upload/init.js');
    const response = await onRequestPost({
      request: new Request('https://vault.example/api/chunked-upload/init', {
        method: 'POST',
        body: JSON.stringify({
          fileName: 'x.bin', fileType: 'application/octet-stream', rootDigest: 'a'.repeat(64),
          fileSize: 11, totalChunks: 2, storageMode: 'r2',
        }),
      }),
      env: localEnv(),
    });
    assert.strictEqual(response.status, 400);
    assert.strictEqual((await response.json()).code, 'CHUNK_PLAN_MISMATCH');
  });

  it('rejects a negative chunk index before coordinator invocation', async function () {
    const { onRequestPost } = await import('../functions/api/chunked-upload/chunk.js');
    let invoked = false;
    const form = new FormData();
    form.append('uploadId', 'u1');
    form.append('chunkIndex', '-1');
    form.append('digest', 'digest');
    form.append('chunk', new File([Uint8Array.of(1)], 'part'));
    const response = await onRequestPost({
      request: new Request('https://vault.example/api/chunked-upload/chunk', { method: 'POST', body: form }),
      env: localEnv(async () => { invoked = true; return new Response('{}'); }),
    });
    assert.strictEqual(response.status, 400);
    assert.strictEqual((await response.json()).code, 'INVALID_CHUNK_INDEX');
    assert.strictEqual(invoked, false);
  });

  it('rejects a missing chunk index instead of treating it as zero', async function () {
    const { onRequestPost } = await import('../functions/api/chunked-upload/chunk.js');
    const form = new FormData();
    form.append('uploadId', 'u-missing');
    form.append('digest', 'digest');
    form.append('chunk', new File([Uint8Array.of(1)], 'part'));
    const response = await onRequestPost({
      request: new Request('https://vault.example/api/chunked-upload/chunk', { method: 'POST', body: form }),
      env: localEnv(),
    });
    assert.strictEqual(response.status, 400);
  });

  it('preserves coordinator completion errors without constructing a file', async function () {
    const { onRequestPost } = await import('../functions/api/chunked-upload/complete.js');
    const response = await onRequestPost({
      request: new Request('https://vault.example/api/chunked-upload/complete', {
        method: 'POST', body: JSON.stringify({ uploadId: 'u2' }),
      }),
      env: localEnv(async () => new Response(JSON.stringify({
        error: { code: 'MULTIPART_PARTS_INCOMPLETE' },
      }), { status: 409 })),
    });
    assert.strictEqual(response.status, 409);
    assert.strictEqual((await response.json()).code, 'MULTIPART_PARTS_INCOMPLETE');
  });
});
