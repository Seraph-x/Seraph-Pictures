const assert = require('node:assert');
const { DatabaseSync } = require('node:sqlite');

const { GuestQuotaService } = require('../shared/security/guest-quota-service.cjs');
const { GuestQuotaRepository } = require('../server/lib/repos/guest-quota-repo');
const { GuestService } = require('../server/lib/utils/guest');

const NOW_MS = 1_800_000_000_000;
const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
const RAW_ADDRESS = '203.0.113.22';
const PNG_BYTES = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
]);

function createQuota(db) {
  let sequence = 0;
  return new GuestQuotaService({
    repository: new GuestQuotaRepository(db),
    clock: { now: () => NOW_MS },
    ids: { create: () => `reservation-${sequence += 1}` },
  });
}

function request() {
  return new Request('http://localhost/upload', {
    headers: { 'x-real-ip': RAW_ADDRESS },
  });
}

function descriptor(overrides = {}) {
  return Object.freeze({
    fileName: 'guest.png',
    mimeType: 'image/png',
    declaredBytes: PNG_BYTES.byteLength,
    buffer: PNG_BYTES,
    ...overrides,
  });
}

function createGuestService(db, overrides = {}) {
  return new GuestService({
    quota: createQuota(db),
    storageRepo: { resolveGuestStorage: () => ({ id: 'guest-storage' }) },
    clock: { now: () => NOW_MS },
    config: {
      guestUploadEnabled: true,
      guestRetentionDays: 3,
      guestMaxFileSize: 20 * 1024 * 1024,
      sessionSecret: 'session-secret-with-at-least-32-characters',
      trustProxy: true,
      ...overrides,
    },
  });
}

describe('Docker guest quota boundary', function () {
  it('persists only an HMAC subject and reserves dedicated storage', async function () {
    const db = new DatabaseSync(':memory:');
    const service = createGuestService(db);
    const reservation = await service.reserveUpload({ request: request(), descriptor: descriptor() });
    const row = db.prepare('SELECT * FROM guest_upload_reservations').get();

    assert.strictEqual(reservation.storageId, 'guest-storage');
    assert.strictEqual(reservation.fileExpiresAt, NOW_MS + THREE_DAYS_MS);
    assert.match(row.subject_hash, /^[a-f0-9]{64}$/);
    assert.strictEqual(JSON.stringify(row).includes(RAW_ADDRESS), false);
  });

  it('rejects forged MIME before consuming a reservation', async function () {
    const db = new DatabaseSync(':memory:');
    const service = createGuestService(db);

    await assert.rejects(
      () => service.reserveUpload({
        request: request(), descriptor: descriptor({ mimeType: 'image/jpeg' }),
      }),
      (error) => error.code === 'GUEST_CONTENT_MISMATCH' && error.status === 415,
    );
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM guest_upload_reservations').get().count, 0);
  });

  it('fails closed without a dedicated guest storage configuration', async function () {
    const db = new DatabaseSync(':memory:');
    const service = new GuestService({
      quota: createQuota(db),
      storageRepo: { resolveGuestStorage: () => null },
      config: createGuestService(db).config,
    });

    await assert.rejects(
      () => service.reserveUpload({ request: request(), descriptor: descriptor() }),
      (error) => error.code === 'GUEST_STORAGE_UNAVAILABLE' && error.status === 503,
    );
  });

  it('treats a missing completion reservation as an explicit error', async function () {
    const service = new GuestService({
      quota: { async complete() { return { ok: true, completed: false }; } },
      storageRepo: {},
      config: {},
      clock: { now: () => NOW_MS },
    });
    await assert.rejects(
      () => service.completeUpload('missing'),
      (error) => error.code === 'GUEST_RESERVATION_INVALID' && error.status === 409,
    );
  });
});
