const LEASE_TTL_MS = 60 * 60 * 1000;

function markerRequired() {
  const error = new Error('MARKER_VERIFICATION_REQUIRED');
  error.code = 'MARKER_VERIFICATION_REQUIRED';
  return error;
}

class MutationBarrierService {
  constructor(options) {
    this.repository = options.repository;
    this.clock = options.clock;
    this.ids = options.ids;
    this.alarms = options.alarms;
  }

  async enter() {
    const now = this.clock.now();
    const leaseId = this.ids.create();
    const result = await this.repository.transaction(() => {
      this.repository.releaseExpired(now);
      const active = this.repository.count();
      if (this.repository.isFrozen()) return { allowed: false, leaseId: null, active };
      this.repository.insert({ leaseId, expiresAt: now + LEASE_TTL_MS });
      return { allowed: true, leaseId, active: active + 1 };
    });
    if (!result.allowed) return Object.freeze(result);
    try {
      await this.alarms.schedule(now + LEASE_TTL_MS);
      return Object.freeze(result);
    } catch (error) {
      await this.repository.transaction(() => this.repository.remove(leaseId));
      throw error;
    }
  }

  async exit(payload) {
    const released = await this.repository.transaction(() => (
      this.repository.remove(payload.leaseId)
    ));
    return Object.freeze({ released, active: this.repository.count() });
  }

  async freezeBegin(payload = {}) {
    if (typeof payload.audience !== 'string' || !payload.audience) {
      throw new Error('MUTATION_BARRIER_AUDIENCE_REQUIRED');
    }
    return this.repository.transaction(() => {
      this.repository.releaseExpired(this.clock.now());
      const current = this.repository.readState();
      if (!current.frozen) {
        this.repository.setState({
          frozen: true, generation: this.ids.create(), audience: payload.audience,
        });
      }
      return Object.freeze({ ...this.repository.readState(), active: this.repository.count() });
    });
  }

  async freezeEnd(payload) {
    if (payload.markerVerified !== true) throw markerRequired();
    return this.repository.transaction(() => {
      const current = this.repository.readState();
      if (payload.generation !== current.generation) throw new Error('BARRIER_GENERATION_MISMATCH');
      if (this.repository.count() !== 0) throw new Error('ACTIVE_MUTATIONS_REMAIN');
      this.repository.setState({ frozen: false, generation: null, audience: null });
      return Object.freeze({ ...this.repository.readState(), active: this.repository.count() });
    });
  }

  async freezeAbort(payload) {
    return this.repository.transaction(() => {
      const current = this.repository.readState();
      if (payload.generation !== current.generation) throw new Error('BARRIER_GENERATION_MISMATCH');
      if (this.repository.count() !== 0) throw new Error('ACTIVE_MUTATIONS_REMAIN');
      this.repository.setState({ frozen: false, generation: null, audience: null });
      return Object.freeze({ ...this.repository.readState(), active: 0 });
    });
  }

  async status() {
    return this.repository.transaction(() => {
      this.repository.releaseExpired(this.clock.now());
      return Object.freeze({ ...this.repository.readState(), active: this.repository.count() });
    });
  }

  async releaseExpired() {
    const released = await this.repository.transaction(() => (
      this.repository.releaseExpired(this.clock.now())
    ));
    return Object.freeze({ released });
  }

  nextAlarmAt() {
    return this.repository.nextExpiry();
  }
}

module.exports = { LEASE_TTL_MS, MutationBarrierService };
