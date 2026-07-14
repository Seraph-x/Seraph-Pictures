import {
  assertReservationMatch,
  commitFinish as finishCommit,
  commitStart as startCommit,
  createPermanentReference,
  createReservation,
  notFound,
  releaseStart as startRelease,
  transferFinish as finishTransfer,
  transferStart as startTransfer,
} from './reference-record.js';

function storageError(code) {
  return Object.assign(new Error(code), { code });
}

function authorityResult(authority) {
  return Object.freeze(authority
    ? { initialized: true, ...authority }
    : { initialized: false, generation: null, ledgerGeneration: null });
}

function validateActivationInput({ generation, expectedGeneration, guardedStorageIds }) {
  const validExpectation = expectedGeneration === null
    || (typeof expectedGeneration === 'string' && expectedGeneration.length > 0);
  const validGuards = Array.isArray(guardedStorageIds)
    && guardedStorageIds.every((id) => typeof id === 'string' && id.length > 0);
  if (typeof generation !== 'string' || !generation || !validExpectation || !validGuards) {
    throw storageError('STORAGE_CATALOG_ACTIVATION_INVALID');
  }
}

function normalizeStagedReferences(references) {
  if (!Array.isArray(references)) throw storageError('STORAGE_LEDGER_STAGE_INVALID');
  return references.map((reference) => {
    if (typeof reference?.operationId !== 'string' || typeof reference?.storageId !== 'string') {
      throw storageError('STORAGE_LEDGER_STAGE_INVALID');
    }
    const normalized = Object.freeze({
      operationId: reference.operationId.trim(), storageId: reference.storageId.trim(),
    });
    if (!normalized.operationId || !normalized.storageId) {
      throw storageError('STORAGE_LEDGER_STAGE_INVALID');
    }
    return normalized;
  });
}

export class StorageReferenceService {
  constructor({ repository, clock, barrier, alarms = null }) {
    this.repository = repository;
    this.clock = clock;
    this.barrier = barrier;
    this.alarms = alarms;
  }

  assertWritesAllowed() {
    if (this.barrier.isFrozen()) throw storageError('STORAGE_PROFILE_MUTATION_FROZEN');
  }

  assertCatalogMutationAllowed(input) {
    if (!this.barrier.isFrozen()) return;
    const state = this.barrier.readState();
    const ownsFreeze = input.freezeGeneration === state.generation
      && input.freezeAudience === state.audience;
    if (!ownsFreeze) throw storageError('STORAGE_PROFILE_MUTATION_FROZEN');
  }

  async reserve(input) {
    this.assertWritesAllowed();
    const result = await this.repository.transaction(() => {
      const existing = this.repository.read(input.operationId);
      if (existing) return { record: assertReservationMatch(existing, input), created: false };
      const created = createReservation({ ...input, now: this.clock.now() });
      this.repository.write(created);
      return { record: created, created: true };
    });
    if (!this.alarms) return result.record;
    try {
      await this.alarms.schedule(result.record.expiresAt);
      return result.record;
    } catch (error) {
      if (result.created) await this.rollbackSafeReservation(result.record.operationId);
      throw error;
    }
  }

  rollbackSafeReservation(operationId) {
    return this.repository.transaction(() => {
      const record = this.repository.read(operationId);
      if (record?.state === 'reserved' && !record.backendWriteStarted) {
        this.repository.remove(operationId);
      }
    });
  }

  async commitStart({ operationId }) {
    return this.update(operationId, startCommit);
  }

  async commitFinish({ operationId }) {
    return this.update(operationId, finishCommit);
  }

  async releaseStart({ operationId }) {
    return this.update(operationId, startRelease);
  }

  async releaseFinish({ operationId }) {
    return this.repository.transaction(() => {
      const record = this.repository.read(operationId);
      if (!record) return Object.freeze({ released: true });
      if (record.state !== 'releasing') throw storageError('STORAGE_REFERENCE_TRANSITION_INVALID');
      this.repository.remove(operationId);
      return Object.freeze({ released: true });
    });
  }

  async transferStart({ operationId, destinationStorageId }) {
    this.assertWritesAllowed();
    return this.update(operationId, (record, now) => (
      startTransfer(record, destinationStorageId, now)
    ));
  }

  async transferFinish({ operationId }) {
    return this.update(operationId, finishTransfer);
  }

  update(operationId, transition) {
    return this.repository.transaction(() => {
      const current = this.repository.read(operationId);
      if (!current) throw notFound();
      const next = transition(current, this.clock.now());
      if (next !== current) this.repository.write(next);
      return next;
    });
  }

  async releaseExpired() {
    return this.repository.transaction(() => {
      const expired = this.repository.listExpiredReserved(this.clock.now());
      expired.forEach((record) => this.repository.remove(record.operationId));
      return Object.freeze({ released: expired.length });
    });
  }

  nextAlarmAt() {
    return this.repository.nextExpiry?.() ?? null;
  }

  async readAuthority() {
    return authorityResult(this.repository.readAuthority());
  }

  async stageLedger(input) {
    this.assertCatalogMutationAllowed(input);
    const { generation, references, reset = false } = input;
    if (typeof generation !== 'string' || !generation) {
      throw storageError('STORAGE_LEDGER_STAGE_INVALID');
    }
    const normalized = normalizeStagedReferences(references);
    return this.repository.transaction(() => {
      if (reset) this.repository.resetStagedLedger(generation);
      if (!this.repository.hasStagedLedger(generation)) {
        throw storageError('STORAGE_LEDGER_STAGE_MISSING');
      }
      for (const reference of normalized) {
        const existing = this.repository.readStagedReference(generation, reference.operationId);
        if (existing) assertReservationMatch(existing, reference);
      }
      this.repository.stageLedger(generation, normalized);
      return Object.freeze({ ok: true, generation, staged: normalized.length });
    });
  }

  async activateCatalog(input) {
    const { generation, expectedGeneration, guardedStorageIds = [] } = input;
    this.assertCatalogMutationAllowed(input);
    validateActivationInput({ generation, expectedGeneration, guardedStorageIds });
    return this.repository.transaction(() => this.activateTransaction({
      generation, expectedGeneration, guardedStorageIds, seedLedger: input.seedLedger === true,
    }));
  }

  activateTransaction({ generation, expectedGeneration, guardedStorageIds, seedLedger }) {
    const current = this.repository.readAuthority();
    const activeGeneration = current?.generation || null;
    if (activeGeneration === generation && current?.ledgerGeneration === generation) {
      return Object.freeze({ ok: true, ...current });
    }
    if (activeGeneration !== expectedGeneration) {
      return Object.freeze({
        ok: false, code: 'STORAGE_GENERATION_CONFLICT', generation: activeGeneration,
      });
    }
    if (guardedStorageIds.some((storageId) => this.repository.count(storageId) > 0)) {
      return Object.freeze({
        ok: false, code: 'STORAGE_PROFILE_IN_USE', generation: activeGeneration,
      });
    }
    if (seedLedger) this.activateStagedLedger(generation);
    const authority = Object.freeze({ generation, ledgerGeneration: generation });
    this.repository.writeAuthority(authority);
    return Object.freeze({ ok: true, ...authority });
  }

  activateStagedLedger(generation) {
    if (!this.repository.hasStagedLedger(generation)) {
      throw storageError('STORAGE_LEDGER_STAGE_MISSING');
    }
    for (const input of this.repository.readStagedLedger(generation)) {
      const current = this.repository.read(input.operationId);
      if (current) {
        assertReservationMatch(current, input);
        continue;
      }
      this.repository.write(createPermanentReference({ ...input, now: this.clock.now() }));
    }
    this.repository.clearStagedLedger(generation);
  }

  async reconcile(input) {
    return this.repository.transaction(() => this.reconcileTransaction(input));
  }

  reconcileTransaction(input) {
    const record = this.repository.read(input.operationId);
    if (!record) throw notFound();
    if (record.state === 'reserved'
      && input.backendObjectExists === false
      && input.metadataCommitted === false) {
      this.repository.remove(record.operationId);
      return Object.freeze({ reconciled: true, state: 'released' });
    }
    if (record.state === 'committing' && input.metadataCommitted === true) {
      const permanent = finishCommit(record, this.clock.now());
      this.repository.write(permanent);
      return permanent;
    }
    return Object.freeze({ reconciled: false, state: record.state });
  }
}
