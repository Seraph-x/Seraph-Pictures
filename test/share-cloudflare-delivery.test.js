const assert = require('node:assert');

const NOW_MS = 1_800_000_000_000;
const CURRENT_SECRET = 'current-secret-with-at-least-32-characters';

function coordinatorBinding(handler) {
  return {
    idFromName() { return 'id'; },
    get() {
      return { async fetch(request) {
        const operation = new URL(request.url).pathname.split('/').pop();
        return Response.json({ data: await handler(operation, await request.json()) });
      } };
    },
  };
}

function leaseCoordinator(record) {
  const state = { consumed: 0, lease: null };
  return {
    state,
    handle(operation, payload) {
      if (operation === 'shareRead') return {
        record: { ...record, downloadCount: state.consumed },
      };
      if (operation === 'shareConsume') {
        state.consumed += 1;
        return { ok: true, record: { ...record, downloadCount: state.consumed } };
      }
      if (operation === 'shareConsumeStartLease') {
        state.consumed += 1;
        state.lease = { ...payload };
        return { ok: true };
      }
      if (operation === 'shareLeaseRead') return { allowed: leaseMatches(state.lease, payload) };
      if (operation === 'shareLeaseAdvance') return advanceLease(state, payload);
      if (operation === 'configReadAuthority') {
        return { initialized: false, committedVersion: null, digest: null };
      }
      throw new Error(`Unexpected operation ${operation}`);
    },
  };
}

function leaseMatches(lease, payload) {
  return Boolean(lease)
    && lease.leaseId === payload.leaseId
    && lease.tokenHash === payload.tokenHash
    && lease.nextOffset === payload.rangeStart;
}

function advanceLease(state, payload) {
  if (!leaseMatches(state.lease, payload)) {
    return { ok: false, code: 'SHARE_LEASE_STALE' };
  }
  state.lease = payload.complete ? null : {
    ...state.lease,
    leaseId: payload.nextLeaseId,
    tokenHash: payload.nextTokenHash,
    nextOffset: payload.nextOffset,
  };
  return { ok: true };
}

function storageEnvironment(coordinator) {
  return {
    FILE_SHARE_SECRET_CURRENT: CURRENT_SECRET,
    AUTH_COORDINATOR: coordinatorBinding(coordinator.handle.bind(coordinator)),
    img_url: {
      async get(key) {
        return key === 'schema:visibility:v1' ? { version: 1, complete: true } : null;
      },
      async getWithMetadata(key) {
        if (key !== 'r2:private.png') return null;
        return { value: '', metadata: {
          fileName: 'private.png', r2Key: 'private.png', visibility: 'private',
          uploadSource: 'drive', accessVersion: 2,
        } };
      },
      async put() {},
    },
    R2_BUCKET: {
      async head() { return { size: 5 }; },
      async get(_key, options) {
        const length = options?.range?.length || 5;
        const bytes = Array.from({ length }, (_value, index) => index + 1);
        return { body: new Uint8Array(bytes), size: bytes.length };
      },
    },
  };
}

async function fileRequest(route, env, target, headers) {
  return route.onRequest({
    request: new Request(target, { headers }),
    params: { id: 'r2:private.png' },
    env,
  });
}

describe('Cloudflare private range delivery', function () {
  it('counts one sequential range session and rejects lease replay', async function () {
    const { signShareRecord } = await import('../functions/services/share-access.js');
    const route = await import('../functions/file/[id].js');
    const record = {
      shareId: 'share-1', fileId: 'r2:private.png', expiresAt: NOW_MS + 60_000,
      accessVersion: 2, revoked: false, passwordHash: null, maxDownloads: 1,
      downloadCount: 0, createdAt: NOW_MS,
    };
    const coordinator = leaseCoordinator(record);
    const env = storageEnvironment(coordinator);
    const signature = await signShareRecord(record, CURRENT_SECRET);
    const target = `https://vault.example/file/r2%3Aprivate.png?share=share-1&exp=${record.expiresAt}&sig=${signature}`;
    const invalid = await fileRequest(route, env, target, { Range: 'bytes=8-9' });
    assert.strictEqual(invalid.status, 404);
    assert.strictEqual(coordinator.state.consumed, 0);
    const first = await fileRequest(route, env, target, { Range: 'bytes=0-0' });
    const cookie = first.headers.get('set-cookie').split(';')[0];
    assert.strictEqual(first.status, 206);
    assert.strictEqual(coordinator.state.consumed, 1);
    const next = await fileRequest(route, env, target, { Range: 'bytes=1-2', Cookie: cookie });
    assert.strictEqual(next.status, 206);
    assert.strictEqual(coordinator.state.consumed, 1);
    const replay = await fileRequest(route, env, target, { Range: 'bytes=1-2', Cookie: cookie });
    assert.strictEqual(replay.status, 404);
    const nextCookie = next.headers.get('set-cookie').split(';')[0];
    const completed = await fileRequest(
      route, env, target, { Range: 'bytes=3-', Cookie: nextCookie },
    );
    assert.strictEqual(completed.status, 206);
    const full = await fileRequest(route, env, target, { Cookie: cookie });
    assert.strictEqual(full.status, 404);
  });
});
