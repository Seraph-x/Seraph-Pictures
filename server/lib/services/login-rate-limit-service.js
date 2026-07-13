const { get, run } = require('../../db');

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;

class LoginRateLimitService {
  constructor({ db, now = Date.now }) {
    this.db = db;
    this.now = now;
  }

  check(ip) {
    const key = this.normalizeIp(ip);
    const row = get(this.db, 'SELECT count, window_expires_at FROM login_failures WHERE ip = ?', [key]);
    if (!row) return { blocked: false, retryAfter: 0 };
    const now = this.now();
    if (now >= Number(row.window_expires_at)) {
      this.clear(key);
      return { blocked: false, retryAfter: 0 };
    }
    const blocked = Number(row.count) >= MAX_FAILED_ATTEMPTS;
    const retryAfter = blocked ? Math.ceil((Number(row.window_expires_at) - now) / 1000) : 0;
    return { blocked, retryAfter };
  }

  recordFailure(ip) {
    const key = this.normalizeIp(ip);
    const now = this.now();
    const row = get(this.db, 'SELECT count, window_expires_at FROM login_failures WHERE ip = ?', [key]);
    const expired = !row || now >= Number(row.window_expires_at);
    const count = expired ? 1 : Number(row.count) + 1;
    const expiresAt = expired ? now + LOCKOUT_WINDOW_MS : Number(row.window_expires_at);
    run(this.db, `INSERT INTO login_failures(ip, count, window_expires_at, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(ip) DO UPDATE SET count = excluded.count,
        window_expires_at = excluded.window_expires_at, updated_at = excluded.updated_at`,
    [key, count, expiresAt, now]);
    return { count, expiresAt };
  }

  clear(ip) {
    run(this.db, 'DELETE FROM login_failures WHERE ip = ?', [this.normalizeIp(ip)]);
  }

  normalizeIp(ip) {
    return String(ip || 'unknown').trim() || 'unknown';
  }
}

module.exports = {
  LOCKOUT_WINDOW_MS,
  MAX_FAILED_ATTEMPTS,
  LoginRateLimitService,
};
