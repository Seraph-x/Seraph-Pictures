const assert = require('node:assert');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const SERVICE_URL = pathToFileURL(path.join(
  ROOT,
  'workers/coordinator/src/storage-references/reference-service.js',
)).href;

class MemoryReferenceRepository {
  constructor() {
    this.records = new Map();
    this.authority = null;
    this.staged = new Map();
  }

  transaction(operation) { return operation(); }
  read(operationId) { return this.records.get(operationId) || null; }
  write(record) { this.records.set(record.operationId, record); }
  remove(operationId) { return this.records.delete(operationId); }
  readAuthority() { return this.authority; }
  writeAuthority(authority) { this.authority = authority; }
  resetStagedLedger(generation) { this.staged.set(generation, new Map()); }
  stageLedger(generation, references) {
    const staged = this.staged.get(generation) || new Map();
    references.forEach((record) => staged.set(record.operationId, record));
    this.staged.set(generation, staged);
  }
  hasStagedLedger(generation) { return this.staged.has(generation); }
  readStagedLedger(generation) { return [...(this.staged.get(generation)?.values() || [])]; }
  readStagedReference(generation, operationId) {
    return this.staged.get(generation)?.get(operationId) || null;
  }
  clearStagedLedger(generation) { this.staged.delete(generation); }

  listExpiredReserved(now) {
    return [...this.records.values()].filter((record) => (
      record.state === 'reserved' && record.expiresAt <= now
    ));
  }

  count(storageId) {
    return [...this.records.values()].filter((record) => (
      record.protectedStorageIds.includes(storageId)
    )).length;
  }
}

function clock(start = 1_000) {
  let now = start;
  return Object.freeze({
    now: () => now,
    advance: (milliseconds) => { now += milliseconds; },
  });
}

async function createFixture(options = {}) {
  const { StorageReferenceService } = await import(SERVICE_URL);
  const repository = new MemoryReferenceRepository();
  const time = clock();
  const barrier = {
    isFrozen: () => Boolean(options.frozen),
    readState: () => options.frozen
      ? { frozen: true, generation: 'migration-1', audience: 'storage-profiles' }
      : { frozen: false, generation: null, audience: null },
  };
  const alarms = options.alarmFailure
    ? { schedule: async () => { throw new Error('alarm unavailable'); } }
    : null;
  const service = new StorageReferenceService({ repository, clock: time, barrier, alarms });
  return { repository, service, time };
}

describe('storage reference coordinator', function () {
  it('converges repeated reserve, commit start, and commit finish calls', async function () {
    const { repository, service } = await createFixture();
    const input = { operationId: 'upload-1', storageId: 'telegram-a', expiresAt: 2_000 };

    assert.deepStrictEqual(await service.reserve(input), await service.reserve(input));
    assert.strictEqual((await service.commitStart({ operationId: 'upload-1' })).state, 'committing');
    assert.strictEqual((await service.commitStart({ operationId: 'upload-1' })).state, 'committing');
    assert.strictEqual((await service.commitFinish({ operationId: 'upload-1' })).state, 'permanent');
    assert.strictEqual((await service.commitFinish({ operationId: 'upload-1' })).state, 'permanent');
    assert.strictEqual(repository.count('telegram-a'), 1);
  });

  it('rejects operation-id reuse for a different storage profile', async function () {
    const { service } = await createFixture();
    await service.reserve({ operationId: 'upload-1', storageId: 'telegram-a', expiresAt: 2_000 });

    await assert.rejects(
      service.reserve({ operationId: 'upload-1', storageId: 'telegram-b', expiresAt: 2_000 }),
      { code: 'STORAGE_REFERENCE_OPERATION_CONFLICT' },
    );
  });

  it('expires only reserved operations that prove no backend write began', async function () {
    const { repository, service, time } = await createFixture();
    await service.reserve({ operationId: 'safe', storageId: 'r2-a', expiresAt: 1_100 });
    await service.reserve({ operationId: 'ambiguous', storageId: 'r2-a', expiresAt: 1_100 });
    await service.commitStart({ operationId: 'ambiguous' });
    time.advance(200);

    assert.deepStrictEqual(await service.releaseExpired({}), { released: 1 });
    assert.strictEqual(repository.read('safe'), null);
    assert.strictEqual(repository.read('ambiguous').state, 'committing');
  });

  it('rolls back a new safe reservation when alarm scheduling fails', async function () {
    const { repository, service } = await createFixture({ alarmFailure: true });
    await assert.rejects(service.reserve({
      operationId: 'safe', storageId: 'r2-a', expiresAt: 2_000,
    }), /alarm unavailable/);
    assert.strictEqual(repository.read('safe'), null);
  });

  it('keeps references protected through release until cleanup is confirmed', async function () {
    const { repository, service } = await createFixture();
    await service.reserve({ operationId: 'file-1', storageId: 's3-a', expiresAt: 2_000 });
    await service.commitStart({ operationId: 'file-1' });
    await service.commitFinish({ operationId: 'file-1' });

    assert.strictEqual((await service.releaseStart({ operationId: 'file-1' })).state, 'releasing');
    assert.strictEqual(repository.count('s3-a'), 1);
    assert.deepStrictEqual(await service.releaseFinish({ operationId: 'file-1' }), { released: true });
    assert.strictEqual(repository.count('s3-a'), 0);
    assert.deepStrictEqual(await service.releaseFinish({ operationId: 'file-1' }), { released: true });
  });

  it('allows an incomplete backend write to enter protected cleanup', async function () {
    const { repository, service } = await createFixture();
    await service.reserve({ operationId: 'multipart-1', storageId: 'r2-a', expiresAt: 2_000 });
    await service.commitStart({ operationId: 'multipart-1' });

    assert.strictEqual(
      (await service.releaseStart({ operationId: 'multipart-1' })).state,
      'releasing',
    );
    assert.strictEqual(repository.count('r2-a'), 1);
    await service.releaseFinish({ operationId: 'multipart-1' });
    assert.strictEqual(repository.count('r2-a'), 0);
  });

  it('atomically protects source and destination during transfer', async function () {
    const { repository, service } = await createFixture();
    await service.reserve({ operationId: 'file-1', storageId: 'telegram-a', expiresAt: 2_000 });
    await service.commitStart({ operationId: 'file-1' });
    await service.commitFinish({ operationId: 'file-1' });

    const transferring = await service.transferStart({
      operationId: 'file-1', destinationStorageId: 'telegram-b',
    });
    assert.deepStrictEqual(transferring.protectedStorageIds, ['telegram-a', 'telegram-b']);
    assert.strictEqual(repository.count('telegram-a'), 1);
    assert.strictEqual(repository.count('telegram-b'), 1);

    const permanent = await service.transferFinish({ operationId: 'file-1' });
    assert.deepStrictEqual(permanent.protectedStorageIds, ['telegram-b']);
    assert.strictEqual(repository.count('telegram-a'), 0);
    assert.strictEqual(repository.count('telegram-b'), 1);
  });

  it('rejects writes and catalog activation while profile mutations are frozen', async function () {
    const { service } = await createFixture({ frozen: true });
    await assert.rejects(
      service.reserve({ operationId: 'upload-1', storageId: 'r2-a', expiresAt: 2_000 }),
      { code: 'STORAGE_PROFILE_MUTATION_FROZEN' },
    );
    await assert.rejects(
      service.activateCatalog({ generation: 'g1', expectedGeneration: null }),
      { code: 'STORAGE_PROFILE_MUTATION_FROZEN' },
    );
  });

  it('allows only the matching freeze owner to activate a migration generation', async function () {
    const { service } = await createFixture({ frozen: true });
    assert.deepStrictEqual(await service.activateCatalog({
      generation: 'g1',
      expectedGeneration: null,
      guardedStorageIds: [],
      freezeGeneration: 'migration-1',
      freezeAudience: 'storage-profiles',
    }), { ok: true, generation: 'g1', ledgerGeneration: 'g1' });
  });

  it('atomically activates a staged migration ledger with its catalog generation', async function () {
    const { repository, service } = await createFixture({ frozen: true });
    const freeze = {
      freezeGeneration: 'migration-1', freezeAudience: 'storage-profiles',
    };
    await service.stageLedger({
      generation: 'g1', reset: true, ...freeze,
      references: [
        { operationId: 'legacy-file-1', storageId: 'telegram-a' },
        { operationId: 'legacy-file-2', storageId: 'telegram-a' },
      ],
    });
    await assert.rejects(service.stageLedger({
      generation: 'g1', ...freeze,
      references: [{ operationId: 'legacy-file-1', storageId: 'telegram-b' }],
    }), { code: 'STORAGE_REFERENCE_OPERATION_CONFLICT' });
    await service.activateCatalog({
      generation: 'g1', expectedGeneration: null, guardedStorageIds: [],
      seedLedger: true, ...freeze,
    });

    assert.strictEqual(repository.count('telegram-a'), 2);
    assert.strictEqual(repository.read('legacy-file-1').state, 'permanent');
    assert.strictEqual(repository.readAuthority().ledgerGeneration, 'g1');
    assert.deepStrictEqual(repository.readStagedLedger('g1'), []);
  });

  it('activates catalog and ledger generations with CAS and reference guards', async function () {
    const { service } = await createFixture();
    assert.deepStrictEqual(await service.readAuthority({}), {
      initialized: false, generation: null, ledgerGeneration: null,
    });
    assert.deepStrictEqual(await service.activateCatalog({
      generation: 'g1', expectedGeneration: null, guardedStorageIds: [],
    }), { ok: true, generation: 'g1', ledgerGeneration: 'g1' });
    assert.deepStrictEqual(await service.activateCatalog({
      generation: 'g2', expectedGeneration: null, guardedStorageIds: [],
    }), { ok: false, code: 'STORAGE_GENERATION_CONFLICT', generation: 'g1' });

    await service.reserve({ operationId: 'file-1', storageId: 'r2-a', expiresAt: 2_000 });
    assert.deepStrictEqual(await service.activateCatalog({
      generation: 'g2', expectedGeneration: 'g1', guardedStorageIds: ['r2-a'],
    }), { ok: false, code: 'STORAGE_PROFILE_IN_USE', generation: 'g1' });
  });

  it('reconciles only outcomes backed by explicit evidence', async function () {
    const { repository, service } = await createFixture();
    await service.reserve({ operationId: 'safe', storageId: 'r2-a', expiresAt: 2_000 });
    await service.reserve({ operationId: 'committing', storageId: 'r2-a', expiresAt: 2_000 });
    await service.commitStart({ operationId: 'committing' });

    assert.deepStrictEqual(await service.reconcile({
      operationId: 'safe', backendObjectExists: false, metadataCommitted: false,
    }), { reconciled: true, state: 'released' });
    assert.strictEqual((await service.reconcile({
      operationId: 'committing', backendObjectExists: true, metadataCommitted: true,
    })).state, 'permanent');
    assert.strictEqual(repository.read('committing').state, 'permanent');
  });

  it('surfaces unknown operations and invalid transitions', async function () {
    const { service } = await createFixture();
    await assert.rejects(service.activateCatalog({
      generation: 'g1', expectedGeneration: 1, guardedStorageIds: [],
    }), { code: 'STORAGE_CATALOG_ACTIVATION_INVALID' });
    await assert.rejects(service.activateCatalog({
      generation: 'g1', expectedGeneration: null, guardedStorageIds: 'r2-a',
    }), { code: 'STORAGE_CATALOG_ACTIVATION_INVALID' });
    await assert.rejects(service.commitStart({ operationId: 'missing' }), {
      code: 'STORAGE_REFERENCE_NOT_FOUND',
    });
    await service.reserve({ operationId: 'upload-1', storageId: 'r2-a', expiresAt: 2_000 });
    await assert.rejects(service.commitFinish({ operationId: 'upload-1' }), {
      code: 'STORAGE_REFERENCE_TRANSITION_INVALID',
    });
  });
});
