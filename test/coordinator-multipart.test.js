const assert = require('node:assert');

const BASE = Object.freeze({
  uploadId: 'upload-1',
  objectKey: 'multipart/upload-1',
  owner: 'owner-1',
  visibility: 'private',
  expectedSize: 10,
  rootDigest: 'root-digest',
  expiresAt: 10_000,
});

const PART_ONE = Object.freeze({
  type: 'PART_UPLOADED',
  partNumber: 1,
  size: 5,
  digest: 'digest-1',
  etag: 'etag-1',
});

async function loadStateMachine() {
  return import('../workers/coordinator/src/upload/state-machine.js');
}

function begin(machine) {
  const created = machine.createMultipartState(BASE);
  return machine.reduceMultipartState({
    state: created,
    event: { type: 'MULTIPART_CREATED', r2UploadId: 'r2-upload-1' },
  });
}

function withPart(machine) {
  return machine.reduceMultipartState({ state: begin(machine), event: PART_ONE });
}

function beginCompletion(machine) {
  return machine.reduceMultipartState({
    state: withPart(machine),
    event: { type: 'COMPLETE_STARTED', parts: [{ partNumber: 1, etag: 'etag-1' }] },
  });
}

describe('multipart upload state machine', function () {
  it('advances through publish and quota commit before completion', async function () {
    const machine = await loadStateMachine();
    const completing = beginCompletion(machine);
    const publishing = machine.reduceMultipartState({
      state: completing,
      event: { type: 'OBJECT_COMPLETED', size: 10, etag: 'object-etag' },
    });
    assert.strictEqual(publishing.phase, 'publish_pending');
    const quotaPending = machine.reduceMultipartState({
      state: publishing,
      event: { type: 'METADATA_PUBLISHED' },
    });
    assert.strictEqual(quotaPending.phase, 'quota_pending');
    const completed = machine.reduceMultipartState({
      state: quotaPending,
      event: { type: 'QUOTA_CONSUMED' },
    });
    assert.strictEqual(completed.phase, 'completed');
    assert.ok(Object.isFrozen(completed));
  });

  it('accepts an identical part retry and rejects a conflicting retry', async function () {
    const machine = await loadStateMachine();
    const uploaded = withPart(machine);
    const identical = machine.reduceMultipartState({ state: uploaded, event: PART_ONE });
    assert.strictEqual(identical, uploaded);
    assert.throws(() => machine.reduceMultipartState({
      state: uploaded,
      event: { ...PART_ONE, digest: 'different-digest' },
    }), /MULTIPART_PART_CONFLICT/);
  });

  it('makes an identical complete retry idempotent', async function () {
    const machine = await loadStateMachine();
    const completing = beginCompletion(machine);
    const retry = machine.reduceMultipartState({
      state: completing,
      event: { type: 'COMPLETE_STARTED', parts: [{ partNumber: 1, etag: 'etag-1' }] },
    });
    assert.strictEqual(retry, completing);
    assert.throws(() => machine.reduceMultipartState({
      state: completing,
      event: { type: 'COMPLETE_STARTED', parts: [{ partNumber: 1, etag: 'other' }] },
    }), /MULTIPART_STATE_INVALID/);
  });

  it('supports abort and rejects complete/cancel races', async function () {
    const machine = await loadStateMachine();
    const aborting = machine.reduceMultipartState({
      state: withPart(machine), event: { type: 'ABORT_STARTED' },
    });
    const aborted = machine.reduceMultipartState({
      state: aborting, event: { type: 'ABORTED' },
    });
    assert.strictEqual(aborted.phase, 'aborted');
    assert.throws(() => machine.reduceMultipartState({
      state: aborting,
      event: { type: 'COMPLETE_STARTED', parts: [{ partNumber: 1, etag: 'etag-1' }] },
    }), /MULTIPART_STATE_INVALID/);
    assert.throws(() => machine.reduceMultipartState({
      state: beginCompletion(machine), event: { type: 'ABORT_STARTED' },
    }), /MULTIPART_STATE_INVALID/);
  });

  it('moves expired uploads through explicit alarm cleanup', async function () {
    const machine = await loadStateMachine();
    const cleanup = machine.reduceMultipartState({
      state: withPart(machine), event: { type: 'EXPIRED' },
    });
    assert.strictEqual(cleanup.phase, 'cleanup_pending');
    const cleaned = machine.reduceMultipartState({
      state: cleanup, event: { type: 'CLEANUP_FINISHED' },
    });
    assert.strictEqual(cleaned.phase, 'aborted');
  });

  it('never mutates input state or event objects', async function () {
    const machine = await loadStateMachine();
    const state = begin(machine);
    const snapshot = structuredClone(state);
    const event = { ...PART_ONE };
    machine.reduceMultipartState({ state, event });
    assert.deepStrictEqual(state, snapshot);
    assert.deepStrictEqual(event, PART_ONE);
  });
});
