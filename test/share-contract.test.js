const assert = require('node:assert');

const {
  DEFAULT_SHARE_TTL_SECONDS,
  MAX_SHARE_TTL_SECONDS,
  MIN_SHARE_TTL_SECONDS,
  buildSharePayload,
  decideShareUse,
  eligibleShareSecrets,
  normalizeShareRequest,
} = require('../shared/security/share-policy.cjs');

const NOW_MS = 1_800_000_000_000;
const CURRENT_SECRET = 'current-secret-with-at-least-32-characters';
const PREVIOUS_SECRET = 'previous-secret-with-at-least-32-characters';

function shareRecord(overrides = {}) {
  return Object.freeze({
    shareId: 'share-1',
    fileId: 'file-1',
    expiresAt: NOW_MS + 60_000,
    accessVersion: 3,
    revoked: false,
    passwordHash: null,
    maxDownloads: null,
    downloadCount: 0,
    createdAt: NOW_MS,
    ...overrides,
  });
}

describe('private share contract', function () {
  it('normalizes default, minimum, and maximum TTL values', function () {
    assert.strictEqual(
      normalizeShareRequest({ fileId: 'f', accessVersion: 1, nowMs: NOW_MS }).expiresAt,
      NOW_MS + DEFAULT_SHARE_TTL_SECONDS * 1000,
    );
    assert.strictEqual(
      normalizeShareRequest({
        fileId: 'f', accessVersion: 1, ttlSeconds: MIN_SHARE_TTL_SECONDS, nowMs: NOW_MS,
      }).expiresAt,
      NOW_MS + MIN_SHARE_TTL_SECONDS * 1000,
    );
    assert.throws(
      () => normalizeShareRequest({ fileId: 'f', accessVersion: 1, ttlSeconds: 59, nowMs: NOW_MS }),
      (error) => error?.code === 'SHARE_TTL_INVALID',
    );
    assert.throws(
      () => normalizeShareRequest({
        fileId: 'f', accessVersion: 1, ttlSeconds: MAX_SHARE_TTL_SECONDS + 1, nowMs: NOW_MS,
      }),
      (error) => error?.code === 'SHARE_TTL_INVALID',
    );
  });

  it('binds the signature payload to share, file, expiry, and access version', function () {
    assert.strictEqual(
      buildSharePayload(shareRecord()),
      `share-1:file-1:${NOW_MS + 60_000}:3`,
    );
  });

  it('accepts the previous secret only inside its explicit rotation window', function () {
    assert.deepStrictEqual(
      eligibleShareSecrets({
        current: CURRENT_SECRET,
        previous: PREVIOUS_SECRET,
        previousValidUntil: NOW_MS + 1,
        nowMs: NOW_MS,
      }),
      [CURRENT_SECRET, PREVIOUS_SECRET],
    );
    assert.deepStrictEqual(
      eligibleShareSecrets({
        current: CURRENT_SECRET,
        previous: PREVIOUS_SECRET,
        previousValidUntil: NOW_MS,
        nowMs: NOW_MS,
      }),
      [CURRENT_SECRET],
    );
  });

  it('allows replay before expiry and blocks revoked, expired, and stale shares', function () {
    assert.strictEqual(decideShareUse({ record: shareRecord(), nowMs: NOW_MS }).allowed, true);
    assert.strictEqual(decideShareUse({ record: shareRecord(), nowMs: NOW_MS + 1 }).allowed, true);
    assert.strictEqual(decideShareUse({
      record: shareRecord({ revoked: true }), nowMs: NOW_MS,
    }).code, 'SHARE_REVOKED');
    assert.strictEqual(decideShareUse({
      record: shareRecord({ expiresAt: NOW_MS }), nowMs: NOW_MS,
    }).code, 'SHARE_EXPIRED');
    assert.strictEqual(decideShareUse({
      record: shareRecord(), nowMs: NOW_MS, expectedAccessVersion: 4,
    }).code, 'SHARE_ACCESS_VERSION_STALE');
  });

  it('enforces password verification and maximum downloads', function () {
    assert.strictEqual(decideShareUse({
      record: shareRecord({ passwordHash: 'hash' }), nowMs: NOW_MS, passwordVerified: false,
    }).code, 'SHARE_PASSWORD_REQUIRED');
    assert.strictEqual(decideShareUse({
      record: shareRecord({ maxDownloads: 2, downloadCount: 2 }), nowMs: NOW_MS,
    }).code, 'SHARE_DOWNLOAD_LIMIT');
    assert.strictEqual(decideShareUse({
      record: shareRecord({ maxDownloads: 2, downloadCount: 1 }), nowMs: NOW_MS,
    }).allowed, true);
  });
});

describe('share coordinator service', function () {
  function repository() {
    const records = new Map();
    let lease = null;
    return {
      transaction(operation) { return operation(); },
      insert(record) { records.set(record.shareId, Object.freeze({ ...record })); },
      read(shareId) { return records.get(shareId) || null; },
      increment(shareId) {
        const current = records.get(shareId);
        records.set(shareId, Object.freeze({
          ...current, downloadCount: current.downloadCount + 1,
        }));
      },
      deleteExpired(nowMs) {
        for (const [shareId, record] of records) {
          if (record.expiresAt <= nowMs) records.delete(shareId);
        }
      },
      revoke(shareId) {
        const current = records.get(shareId);
        if (current) records.set(shareId, Object.freeze({ ...current, revoked: true }));
      },
      readLease(shareId, leaseId) {
        return lease?.share_id === shareId && lease?.lease_id === leaseId ? lease : null;
      },
      putLease(value) {
        lease = {
          lease_id: value.leaseId,
          share_id: value.shareId,
          token_hash: value.tokenHash,
          next_offset: value.nextOffset,
          expires_at: value.expiresAt,
        };
      },
      deleteLease() { lease = null; },
    };
  }

  it('atomically consumes the final allowed download and rejects the next', async function () {
    const { ShareCoordinatorService } = await import(
      '../workers/coordinator/src/share/share-coordinator.js'
    );
    const service = new ShareCoordinatorService({ repository: repository() });
    await service.create(shareRecord({ maxDownloads: 1 }));

    const first = await service.consume({
      shareId: 'share-1', nowMs: NOW_MS, expectedAccessVersion: 3,
    });
    const second = await service.consume({
      shareId: 'share-1', nowMs: NOW_MS, expectedAccessVersion: 3,
    });

    assert.strictEqual(first.ok, true);
    assert.strictEqual(first.record.downloadCount, 1);
    assert.deepStrictEqual(second, { ok: false, code: 'SHARE_DOWNLOAD_LIMIT' });
  });

  it('revokes a share explicitly', async function () {
    const { ShareCoordinatorService } = await import(
      '../workers/coordinator/src/share/share-coordinator.js'
    );
    const service = new ShareCoordinatorService({ repository: repository() });
    await service.create(shareRecord());
    assert.deepStrictEqual(await service.revoke({ shareId: 'share-1' }), { revoked: true });
    assert.deepStrictEqual(
      await service.consume({
        shareId: 'share-1', nowMs: NOW_MS, expectedAccessVersion: 3,
      }),
      { ok: false, code: 'SHARE_REVOKED' },
    );
  });

  it('rotates a sequential range lease and rejects replay', async function () {
    const { ShareCoordinatorService } = await import(
      '../workers/coordinator/src/share/share-coordinator.js'
    );
    const service = new ShareCoordinatorService({ repository: repository() });
    service.create(shareRecord());
    const started = service.consumeStartLease({
      shareId: 'share-1', leaseId: 'lease-1', tokenHash: 'hash-1',
      rangeStart: 0, nextOffset: 10, nowMs: NOW_MS,
      expectedAccessVersion: 3, passwordVerified: true,
    });
    assert.strictEqual(started.ok, true);
    assert.strictEqual(service.leaseRead({
      shareId: 'share-1', leaseId: 'lease-1', tokenHash: 'hash-1',
      rangeStart: 10, nowMs: NOW_MS,
    }).allowed, true);
    const advanced = service.leaseAdvance({
      shareId: 'share-1', leaseId: 'lease-1', tokenHash: 'hash-1',
      rangeStart: 10, nextLeaseId: 'lease-2', nextTokenHash: 'hash-2',
      nextOffset: 20, complete: false, nowMs: NOW_MS,
    });
    assert.strictEqual(advanced.ok, true);
    const replayedAdvance = service.leaseAdvance({
      shareId: 'share-1', leaseId: 'lease-1', tokenHash: 'hash-1',
      rangeStart: 10, nextLeaseId: 'lease-3', nextTokenHash: 'hash-3',
      nextOffset: 20, complete: false, nowMs: NOW_MS,
    });
    assert.deepStrictEqual(replayedAdvance, {
      ok: false, code: 'SHARE_LEASE_STALE',
    });
    assert.strictEqual(service.leaseRead({
      shareId: 'share-1', leaseId: 'lease-1', tokenHash: 'hash-1',
      rangeStart: 10, nowMs: NOW_MS,
    }).allowed, false);
  });
});
