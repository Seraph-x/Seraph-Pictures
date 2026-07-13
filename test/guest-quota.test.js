const assert = require('node:assert');

const {
  GUEST_LIMITS,
  validateGuestUpload,
} = require('../shared/security/guest-policy.cjs');

const NOW_MS = 1_800_000_000_000;
const SUBJECT_HASH = 'a'.repeat(64);

function descriptor(overrides = {}) {
  return {
    fileName: 'image.png',
    mimeType: 'image/png',
    detectedMimeType: 'image/png',
    declaredBytes: 4,
    actualBytes: 4,
    retentionDays: 3,
    ...overrides,
  };
}

function memoryRepository() {
  const records = new Map();
  return {
    records,
    transaction(operation) { return operation(); },
    releaseExpired(nowMs) {
      let released = 0;
      for (const [id, record] of records) {
        if (record.state === 'reserved' && record.expiresAt <= nowMs) {
          records.delete(id);
          released += 1;
        }
      }
      return released;
    },
    countDay(subjectHash, dayKey) {
      return [...records.values()].filter((record) => (
        record.subjectHash === subjectHash && record.dayKey === dayKey
      )).length;
    },
    countBurst(subjectHash, sinceMs) {
      return [...records.values()].filter((record) => (
        record.subjectHash === subjectHash && record.createdAt > sinceMs
      )).length;
    },
    insert(record) { records.set(record.reservationId, Object.freeze({ ...record })); },
    read(id) { return records.get(id) || null; },
    complete(id) {
      const record = records.get(id);
      if (record?.state === 'reserved') {
        records.set(id, Object.freeze({ ...record, state: 'completed' }));
        return true;
      }
      return false;
    },
    cancel(id) {
      if (records.get(id)?.state !== 'reserved') return false;
      records.delete(id);
      return true;
    },
    nextExpiry() {
      const expiries = [...records.values()]
        .filter((record) => record.state === 'reserved')
        .map((record) => record.expiresAt);
      return expiries.length ? Math.min(...expiries) : null;
    },
  };
}

describe('guest upload policy', function () {
  it('accepts a consistent image under the fixed maximum', function () {
    assert.deepStrictEqual(validateGuestUpload(descriptor()), {
      allowed: true, code: null,
    });
  });

  it('rejects size, MIME, extension, and retention inconsistencies', function () {
    assert.strictEqual(validateGuestUpload(descriptor({
      actualBytes: GUEST_LIMITS.maximumFileBytes + 1,
      declaredBytes: GUEST_LIMITS.maximumFileBytes + 1,
    })).code, 'GUEST_FILE_TOO_LARGE');
    assert.strictEqual(validateGuestUpload(descriptor({ actualBytes: 5 })).code,
      'GUEST_SIZE_MISMATCH');
    assert.strictEqual(validateGuestUpload(descriptor({ mimeType: 'text/html' })).code,
      'GUEST_MIME_REJECTED');
    assert.strictEqual(validateGuestUpload(descriptor({ detectedMimeType: 'image/jpeg' })).code,
      'GUEST_CONTENT_MISMATCH');
    assert.strictEqual(validateGuestUpload(descriptor({ fileName: 'image.jpg' })).code,
      'GUEST_CONTENT_MISMATCH');
    assert.strictEqual(validateGuestUpload(descriptor({ retentionDays: 0 })).code,
      'GUEST_RETENTION_REQUIRED');
  });
});

describe('guest quota coordinator', function () {
  async function createService(options = {}) {
    const module = await import('../workers/coordinator/src/quota/quota-coordinator.js');
    let nowMs = NOW_MS;
    let sequence = 0;
    const repository = memoryRepository();
    const service = new module.GuestQuotaService({
      repository,
      clock: { now: () => nowMs },
      ids: { create: () => `reservation-${sequence += 1}` },
      alarms: { async schedule() {} },
    });
    return {
      service,
      repository,
      advance(milliseconds) { nowMs += milliseconds; },
      ...options,
    };
  }

  it('atomically enforces five reservations per minute', async function () {
    const { service } = await createService();
    const results = await Promise.all(Array.from({ length: 6 }, () => (
      service.reserve({ subjectHash: SUBJECT_HASH })
    )));

    assert.strictEqual(results.filter((result) => result.ok).length, 5);
    assert.strictEqual(results[5].code, 'GUEST_BURST_LIMIT');
  });

  it('enforces ten daily reservations across burst windows', async function () {
    const state = await createService();
    const results = [];
    for (let batch = 0; batch < 3; batch += 1) {
      for (let index = 0; index < 5; index += 1) {
        results.push(await state.service.reserve({ subjectHash: SUBJECT_HASH }));
      }
      state.advance((GUEST_LIMITS.burstWindowSeconds + 1) * 1000);
    }
    assert.strictEqual(results.filter((result) => result.ok).length, 10);
    assert.strictEqual(results.at(-1).code, 'GUEST_DAILY_LIMIT');
  });

  it('completes, cancels, and releases abandoned reservations', async function () {
    const state = await createService();
    const completed = await state.service.reserve({ subjectHash: SUBJECT_HASH });
    const cancelled = await state.service.reserve({ subjectHash: SUBJECT_HASH });
    const abandoned = await state.service.reserve({ subjectHash: SUBJECT_HASH });
    assert.deepStrictEqual(await state.service.complete({
      reservationId: completed.reservationId,
    }), { ok: true, completed: true });
    assert.deepStrictEqual(await state.service.complete({
      reservationId: completed.reservationId,
    }), { ok: true, completed: true });
    assert.deepStrictEqual(await state.service.cancel({
      reservationId: cancelled.reservationId,
    }), { ok: true, cancelled: true });
    state.advance((GUEST_LIMITS.abandonedReservationSeconds + 1) * 1000);
    assert.strictEqual((await state.service.releaseExpired({})).released, 1);
    assert.strictEqual(state.repository.records.has(abandoned.reservationId), false);
    assert.strictEqual(state.repository.records.has(completed.reservationId), true);
  });

  it('schedules expiry after an asynchronous Durable Object transaction', async function () {
    const module = await import('../workers/coordinator/src/quota/quota-coordinator.js');
    const repository = memoryRepository();
    const synchronousTransaction = repository.transaction.bind(repository);
    repository.transaction = async (operation) => synchronousTransaction(operation);
    let scheduledAt = null;
    const service = new module.GuestQuotaService({
      repository,
      clock: { now: () => NOW_MS },
      ids: { create: () => 'reservation-async' },
      alarms: { async schedule(timestamp) { scheduledAt = timestamp; } },
    });

    const result = await service.reserve({ subjectHash: SUBJECT_HASH });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(scheduledAt, result.expiresAt);
  });
});

describe('Cloudflare guest quota boundary', function () {
  it('hashes only the Cloudflare client address before reservation', async function () {
    const { reserveGuestUpload } = await import('../functions/services/guest-quota.js');
    let payload;
    const env = {
      SESSION_SECRET: 'session-secret-with-at-least-32-characters',
      AUTH_COORDINATOR: {
        idFromName() { return 'id'; },
        get() { return { async fetch(request) {
          payload = await request.json();
          return Response.json({ data: {
            ok: true, reservationId: 'reservation-1', expiresAt: NOW_MS + 60_000,
          } });
        } }; },
      },
    };
    const result = await reserveGuestUpload({
      request: new Request('https://vault.example/upload', {
        headers: {
          'CF-Connecting-IP': '203.0.113.8',
          'X-Forwarded-For': '198.51.100.2',
        },
      }),
      env,
      descriptor: descriptor(),
    });

    assert.strictEqual(result.reservationId, 'reservation-1');
    assert.match(payload.subjectHash, /^[a-f0-9]{64}$/);
    assert.strictEqual(JSON.stringify(payload).includes('203.0.113.8'), false);
    assert.strictEqual(JSON.stringify(payload).includes('198.51.100.2'), false);
  });

  it('fails closed when the coordinator binding is missing', async function () {
    const { reserveGuestUpload } = await import('../functions/services/guest-quota.js');
    await assert.rejects(
      () => reserveGuestUpload({
        request: new Request('https://vault.example/upload'),
        env: { SESSION_SECRET: 'session-secret-with-at-least-32-characters' },
        descriptor: descriptor(),
      }),
      (error) => error.code === 'AUTH_STATE_UNAVAILABLE',
    );
  });

  it('fails closed before storage selection when guest credentials are absent', async function () {
    const { assertDedicatedGuestStorage } = await import('../functions/services/guest-quota.js');
    assert.throws(
      () => assertDedicatedGuestStorage({ TG_Bot_Token: 'admin-token', TG_Chat_ID: 'admin-chat' }),
      (error) => error.code === 'GUEST_STORAGE_UNAVAILABLE' && error.status === 503,
    );
  });
});
