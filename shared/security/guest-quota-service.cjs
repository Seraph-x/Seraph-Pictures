const { GUEST_LIMITS } = require('./guest-policy.cjs');

const MILLISECONDS_PER_SECOND = 1000;

function dayKey(nowMs) {
  return new Date(nowMs).toISOString().slice(0, 10);
}

function quotaError(code) {
  return Object.freeze({ ok: false, code });
}

function validSubject(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

class GuestQuotaService {
  constructor(options) {
    this.repository = options.repository;
    this.clock = options.clock;
    this.ids = options.ids;
    this.alarms = options.alarms || null;
  }

  async reserve({ subjectHash }) {
    if (!validSubject(subjectHash)) return quotaError('GUEST_SUBJECT_INVALID');
    const nowMs = this.clock.now();
    const result = await this.repository.transaction(() => this.reserveTransaction({
      subjectHash, nowMs,
    }));
    if (result.ok && this.alarms) await this.alarms.schedule(result.expiresAt);
    return result;
  }

  reserveTransaction({ subjectHash, nowMs }) {
    this.repository.releaseExpired(nowMs);
    const currentDay = dayKey(nowMs);
    if (this.repository.countDay(subjectHash, currentDay) >= GUEST_LIMITS.dailyUploads) {
      return quotaError('GUEST_DAILY_LIMIT');
    }
    const burstStart = nowMs - GUEST_LIMITS.burstWindowSeconds * MILLISECONDS_PER_SECOND;
    if (this.repository.countBurst(subjectHash, burstStart) >= GUEST_LIMITS.burstUploads) {
      return quotaError('GUEST_BURST_LIMIT');
    }
    const expiresAt = nowMs
      + GUEST_LIMITS.abandonedReservationSeconds * MILLISECONDS_PER_SECOND;
    const reservationId = this.ids.create();
    this.repository.insert(Object.freeze({
      reservationId, subjectHash, dayKey: currentDay, state: 'reserved',
      createdAt: nowMs, expiresAt,
    }));
    return Object.freeze({ ok: true, reservationId, expiresAt });
  }

  complete({ reservationId }) {
    return this.repository.transaction(() => {
      const changed = this.repository.complete(reservationId);
      const completed = changed || this.repository.read(reservationId)?.state === 'completed';
      return Object.freeze({ ok: true, completed });
    });
  }

  cancel({ reservationId }) {
    return this.repository.transaction(() => Object.freeze({
      ok: true, cancelled: this.repository.cancel(reservationId),
    }));
  }

  releaseExpired() {
    return this.repository.transaction(() => Object.freeze({
      released: this.repository.releaseExpired(this.clock.now()),
    }));
  }

  nextAlarmAt() {
    return this.repository.nextExpiry();
  }
}

module.exports = { GuestQuotaService };
