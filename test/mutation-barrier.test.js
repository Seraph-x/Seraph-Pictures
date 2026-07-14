const assert = require('node:assert');

class MemoryRepository {
  constructor() {
    this.state = { frozen: false, generation: null, audience: null };
    this.leases = new Map();
  }

  transaction(operation) { return operation(); }
  setState(value) { this.state = { ...value }; }
  readState() { return { ...this.state }; }
  isFrozen() { return this.state.frozen; }
  insert(record) { this.leases.set(record.leaseId, record); }
  remove(leaseId) { return this.leases.delete(leaseId); }
  count() { return this.leases.size; }
  releaseExpired(now) {
    let released = 0;
    for (const [id, lease] of this.leases) {
      if (lease.expiresAt <= now) { this.leases.delete(id); released += 1; }
    }
    return released;
  }
  nextExpiry() {
    const values = [...this.leases.values()].map((lease) => lease.expiresAt);
    return values.length ? Math.min(...values) : null;
  }
}

function harness() {
  const repository = new MemoryRepository();
  let now = 1_000;
  let sequence = 0;
  const alarms = [];
  return {
    repository,
    alarms,
    setNow(value) { now = value; },
    dependencies: {
      repository,
      clock: { now: () => now },
      ids: { create: () => `lease-${++sequence}` },
      alarms: { schedule: async (timestamp) => { alarms.push(timestamp); } },
    },
  };
}

describe('coordinator mutation barrier', function () {
  it('tracks active mutations and drains them after freezing', async function () {
    const barrierModule = await import('../shared/security/mutation-barrier-service.cjs');
    const state = harness();
    const service = new barrierModule.MutationBarrierService(state.dependencies);

    const entered = await service.enter({});
    assert.deepStrictEqual(await service.freezeBegin({ audience: 'namespace' }), {
      frozen: true, generation: 'lease-2', audience: 'namespace', active: 1,
    });
    assert.deepStrictEqual(await service.enter({}), {
      allowed: false, leaseId: null, active: 1,
    });
    await assert.rejects(
      service.freezeEnd({ markerVerified: true, generation: 'lease-2' }),
      /ACTIVE_MUTATIONS_REMAIN/,
    );
    assert.deepStrictEqual(await service.exit({ leaseId: entered.leaseId }), {
      released: true, active: 0,
    });
    assert.deepStrictEqual(await service.status({}), {
      frozen: true, generation: 'lease-2', audience: 'namespace', active: 0,
    });
  });

  it('cannot unfreeze before the visibility marker is verified', async function () {
    const barrierModule = await import('../shared/security/mutation-barrier-service.cjs');
    const service = new barrierModule.MutationBarrierService(harness().dependencies);
    const frozen = await service.freezeBegin({ audience: 'namespace' });

    await assert.rejects(service.freezeEnd({ markerVerified: false }), /MARKER_VERIFICATION_REQUIRED/);
    await assert.rejects(
      service.freezeEnd({ markerVerified: true, generation: 'old-generation' }),
      /BARRIER_GENERATION_MISMATCH/,
    );
    assert.deepStrictEqual(await service.freezeEnd({
      markerVerified: true, generation: frozen.generation,
    }), {
      frozen: false, generation: null, audience: null, active: 0,
    });
  });

  it('supports owner-tokened migration abort without claiming marker verification', async function () {
    const barrierModule = await import('../shared/security/mutation-barrier-service.cjs');
    const service = new barrierModule.MutationBarrierService(harness().dependencies);
    const frozen = await service.freezeBegin({ audience: 'storage-profiles' });

    await assert.rejects(service.freezeAbort({ generation: 'wrong' }), /BARRIER_GENERATION_MISMATCH/);
    assert.deepStrictEqual(await service.freezeAbort({ generation: frozen.generation }), {
      frozen: false, generation: null, audience: null, active: 0,
    });
  });

  it('releases abandoned leases explicitly through expiry processing', async function () {
    const barrierModule = await import('../shared/security/mutation-barrier-service.cjs');
    const state = harness();
    const service = new barrierModule.MutationBarrierService(state.dependencies);
    await service.enter({});
    state.setNow(4_000_000);

    assert.deepStrictEqual(await service.releaseExpired({}), { released: 1 });
    assert.deepStrictEqual(await service.status({}), {
      frozen: false, generation: null, audience: null, active: 0,
    });
  });
});
