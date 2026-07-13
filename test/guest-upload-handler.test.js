const assert = require('node:assert');

const PNG_BYTES = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
]);

function kvBinding() {
  const writes = [];
  return {
    writes,
    async get(key) {
      if (key !== 'guest_config') return null;
      return {
        enabled: true, retentionDays: 3, dailyLimit: 10,
        maxFileSize: 20 * 1024 * 1024,
      };
    },
    async put(key, value, options) { writes.push({ key, value, options }); },
  };
}

function coordinator(operations, options = {}) {
  return {
    idFromName() { return 'coordinator-id'; },
    get() { return { async fetch(request) {
      const operation = new URL(request.url).pathname.split('/').at(-1);
      operations.push(operation);
      if (operation === 'configReadAuthority') {
        return Response.json({ data: {
          initialized: false, committedVersion: null, digest: null,
        } });
      }
      if (operation === 'quotaReserve') {
        return Response.json({ data: {
          ok: true, reservationId: 'reservation-1', expiresAt: Date.now() + 60_000,
        } });
      }
      if (operation === 'quotaComplete') {
        if (options.failComplete) {
          return Response.json({ error: { code: 'AUTH_STATE_UNAVAILABLE' } }, { status: 503 });
        }
        return Response.json({ data: { ok: true, completed: true } });
      }
      if (operation === 'status') {
        return Response.json({ data: {
          initialized: true, schemaVersion: 1, legacyCleanupRequired: false,
        } });
      }
      return Response.json({ data: { ok: true, cancelled: true } });
    } }; },
  };
}

function context(operations, kv, options = {}) {
  const form = new FormData();
  form.append('file', new File([PNG_BYTES], 'guest.png', { type: 'image/png' }));
  return {
    request: new Request('https://vault.example/upload', {
      method: 'POST', body: form, headers: { 'CF-Connecting-IP': '203.0.113.8' },
    }),
    env: {
      img_url: kv,
      SESSION_SECRET: 'session-secret-with-at-least-32-characters',
      AUTH_COORDINATOR: coordinator(operations, options),
      TG_GUEST_BOT_TOKEN: 'guest-token',
      TG_GUEST_CHAT_ID: 'guest-chat',
    },
  };
}

function remoteContext(operations, kv) {
  const base = context(operations, kv);
  return {
    ...base,
    request: new Request('https://vault.example/api/upload-from-url', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://images.example/guest.png' }),
      headers: {
        'Content-Type': 'application/json',
        'CF-Connecting-IP': '203.0.113.8',
      },
    }),
    env: { ...base.env, URL_UPLOAD_ALLOWED_HOSTS: 'images.example' },
  };
}

describe('Cloudflare guest upload handler', function () {
  const originalFetch = global.fetch;

  afterEach(function () { global.fetch = originalFetch; });

  it('reserves, stores without raw IP, then completes', async function () {
    const operations = [];
    const kv = kvBinding();
    let telegramUrl;
    global.fetch = async (url) => {
      telegramUrl = String(url);
      return Response.json({
        ok: true,
        result: { message_id: 7, photo: [{ file_id: 'telegram-file', file_size: 9 }] },
      });
    };
    const middlewareContext = context(operations, kv);
    middlewareContext.next = async () => { throw new Error('guest middleware bypassed'); };
    const { onRequest } = await import('../functions/_middleware.js');
    const response = await onRequest(middlewareContext);

    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual(operations, [
      'status', 'configReadAuthority', 'quotaReserve', 'quotaComplete',
    ]);
    assert.match(telegramUrl, /botguest-token\/sendPhoto$/);
    assert.strictEqual(JSON.stringify(kv.writes).includes('203.0.113.8'), false);
    assert.strictEqual(kv.writes[0].options.metadata.guest, true);
  });

  it('cancels the reservation when Telegram rejects the upload', async function () {
    const operations = [];
    const kv = kvBinding();
    global.fetch = async () => Response.json({ ok: false, description: 'rejected' }, {
      status: 400,
    });
    const { handleGuestUpload } = await import('../functions/services/guest-upload-handler.js');
    const response = await handleGuestUpload(context(operations, kv), '/upload');

    assert.strictEqual(response.status, 502);
    assert.deepStrictEqual(operations, [
      'configReadAuthority', 'quotaReserve', 'quotaCancel',
    ]);
  });

  it('validates a remote image before reserving and uploading it', async function () {
    const operations = [];
    const kv = kvBinding();
    const urls = [];
    global.fetch = async (url) => {
      urls.push(String(url));
      if (urls.length === 1) {
        return new Response(PNG_BYTES, { headers: { 'Content-Type': 'image/png' } });
      }
      return Response.json({
        ok: true,
        result: { message_id: 8, photo: [{ file_id: 'remote-file', file_size: 9 }] },
      });
    };
    const { handleGuestUpload } = await import('../functions/services/guest-upload-handler.js');
    const response = await handleGuestUpload(
      remoteContext(operations, kv), '/api/upload-from-url',
    );

    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual(operations, [
      'configReadAuthority', 'quotaReserve', 'quotaComplete',
    ]);
    assert.strictEqual(urls[0], 'https://images.example/guest.png');
    assert.match(urls[1], /botguest-token\/sendPhoto$/);
  });

  it('rejects guest chunk initialization before temporary storage writes', async function () {
    const operations = [];
    const kv = kvBinding();
    const base = context(operations, kv);
    const middlewareContext = {
      ...base,
      request: new Request('https://vault.example/api/chunked-upload/init', {
        method: 'POST', body: JSON.stringify({ fileName: 'guest.png' }),
      }),
      next: async () => { throw new Error('guest chunk middleware bypassed'); },
    };
    const { onRequest } = await import('../functions/_middleware.js');
    const response = await onRequest(middlewareContext);

    assert.strictEqual(response.status, 403);
    assert.deepStrictEqual(operations, ['status']);
    assert.strictEqual(kv.writes.length, 0);
  });

  it('does not cancel after storage succeeds when quota completion is unavailable', async function () {
    const operations = [];
    const kv = kvBinding();
    global.fetch = async () => Response.json({
      ok: true,
      result: { message_id: 9, photo: [{ file_id: 'stored-file', file_size: 9 }] },
    });
    const { handleGuestUpload } = await import('../functions/services/guest-upload-handler.js');
    const response = await handleGuestUpload(
      context(operations, kv, { failComplete: true }), '/upload',
    );

    assert.strictEqual(response.status, 503);
    assert.deepStrictEqual(operations, [
      'configReadAuthority', 'quotaReserve', 'quotaComplete',
    ]);
    assert.strictEqual(kv.writes.length, 1);
  });
});
