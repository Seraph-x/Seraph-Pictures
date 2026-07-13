const assert = require('node:assert');

class MemoryConfigRepository {
  constructor() {
    this.state = null;
  }

  async transaction(operation) {
    return operation();
  }

  readState() {
    return this.state;
  }

  writeState(state) {
    this.state = Object.freeze({ ...state });
  }
}

describe('coordinator config commit protocol', function () {
  it('serializes concurrent begins and commits only the matching digest', async function () {
    const { ConfigStateService } = await import(
      '../workers/coordinator/src/config/config-state-service.js'
    );
    const repository = new MemoryConfigRepository();
    const service = new ConfigStateService({ repository, clock: { now: () => 1_000 } });

    const [first, second] = await Promise.all([
      service.begin({ digest: 'sha256:first', expectedVersion: 0, expectedDigest: null }),
      service.begin({ digest: 'sha256:second', expectedVersion: 0, expectedDigest: null }),
    ]);

    assert.strictEqual([first, second].filter((result) => result.ok).length, 1);
    assert.strictEqual([first, second].filter((result) => !result.ok)[0].code, 'CONFIG_WRITE_IN_PROGRESS');
    await assert.rejects(
      () => service.commit({ version: 1, digest: 'sha256:wrong' }),
      (error) => error?.code === 'CONFIG_COMMIT_MISMATCH',
    );
    assert.deepStrictEqual(
      await service.commit({ version: 1, digest: 'sha256:first' }),
      { ok: true, committedVersion: 1 },
    );
  });

  it('makes commit retries idempotent and aborts stale pending writes', async function () {
    const { ConfigStateService } = await import(
      '../workers/coordinator/src/config/config-state-service.js'
    );
    const repository = new MemoryConfigRepository();
    let now = 1_000;
    const service = new ConfigStateService({ repository, clock: { now: () => now } });

    await service.begin({ digest: 'sha256:first', expectedVersion: 0, expectedDigest: null });
    await service.commit({ version: 1, digest: 'sha256:first' });
    assert.deepStrictEqual(
      await service.commit({ version: 1, digest: 'sha256:first' }),
      { ok: true, committedVersion: 1 },
    );
    await service.begin({ digest: 'sha256:second', expectedVersion: 1, expectedDigest: 'sha256:first' });
    now += 10 * 60 * 1_000;

    assert.deepStrictEqual(await service.abortStale({}), { aborted: true });
    assert.deepStrictEqual(await service.readAuthority({}), {
      initialized: true,
      committedVersion: 1,
      digest: 'sha256:first',
    });
  });

  it('rejects a stale writer after another writer commits', async function () {
    const { ConfigStateService } = await import(
      '../workers/coordinator/src/config/config-state-service.js'
    );
    const repository = new MemoryConfigRepository();
    const service = new ConfigStateService({ repository, clock: { now: () => 1_000 } });

    await service.begin({ digest: 'sha256:first', expectedVersion: 0, expectedDigest: null });
    await service.commit({ version: 1, digest: 'sha256:first' });
    const stale = await service.begin({
      digest: 'sha256:stale',
      expectedVersion: 0,
      expectedDigest: null,
    });

    assert.deepStrictEqual(stale, { ok: false, code: 'CONFIG_VERSION_CONFLICT' });
    assert.deepStrictEqual(await service.readAuthority({}), {
      initialized: true,
      committedVersion: 1,
      digest: 'sha256:first',
    });
  });

  it('clears pending state when alarm scheduling fails', async function () {
    const { ConfigStateService } = await import(
      '../workers/coordinator/src/config/config-state-service.js'
    );
    const repository = new MemoryConfigRepository();
    const alarms = { schedule: async () => { throw new Error('alarm unavailable'); } };
    const service = new ConfigStateService({
      repository,
      alarms,
      clock: { now: () => 1_000 },
    });

    await assert.rejects(
      () => service.begin({ digest: 'sha256:first', expectedVersion: 0, expectedDigest: null }),
      /alarm unavailable/,
    );
    assert.strictEqual(repository.readState().pendingVersion, null);
  });
});
