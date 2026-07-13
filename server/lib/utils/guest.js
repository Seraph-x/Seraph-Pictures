const { createHmac } = require('node:crypto');

const {
  GUEST_LIMITS,
  detectImageMime,
  validateGuestUpload,
} = require('../../../shared/security/guest-policy.cjs');

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

class GuestUploadError extends Error {
  constructor(code, status, message = code) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function trustedClientAddress(request, trustProxy) {
  if (!trustProxy) throw new GuestUploadError('GUEST_TRUST_PROXY_REQUIRED', 503);
  return request.headers.get('cf-connecting-ip')
    || request.headers.get('x-real-ip')
    || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || 'unknown';
}

function subjectHash(secret, address) {
  if (String(secret || '').length < 32) {
    throw new GuestUploadError('GUEST_QUOTA_SECRET_UNAVAILABLE', 503);
  }
  return createHmac('sha256', secret).update(address).digest('hex');
}

function assertPolicy(config, descriptor) {
  const buffer = descriptor.buffer;
  const result = validateGuestUpload({
    fileName: descriptor.fileName,
    mimeType: descriptor.mimeType,
    detectedMimeType: detectImageMime(buffer),
    declaredBytes: descriptor.declaredBytes,
    actualBytes: buffer.byteLength,
    maximumFileBytes: config.guestMaxFileSize,
    retentionDays: config.guestRetentionDays,
  });
  if (!result.allowed) throw new GuestUploadError(result.code, result.status);
}

class GuestService {
  constructor(options) {
    this.quota = options.quota;
    this.storageRepo = options.storageRepo;
    this.config = options.config;
    this.clock = options.clock;
  }

  getConfig() {
    if (!this.config.guestUploadEnabled) {
      return Object.freeze({ enabled: false, maxFileSize: 0, dailyLimit: 0 });
    }
    return Object.freeze({
      enabled: true,
      maxFileSize: Math.min(this.config.guestMaxFileSize, GUEST_LIMITS.maximumFileBytes),
      dailyLimit: GUEST_LIMITS.dailyUploads,
    });
  }

  async reserveUpload({ request, descriptor }) {
    if (!this.config.guestUploadEnabled) {
      throw new GuestUploadError('GUEST_UPLOAD_DISABLED', 401);
    }
    assertPolicy(this.config, descriptor);
    const storage = this.storageRepo.resolveGuestStorage();
    if (!storage) throw new GuestUploadError('GUEST_STORAGE_UNAVAILABLE', 503);
    const address = trustedClientAddress(request, this.config.trustProxy);
    const hash = subjectHash(this.config.sessionSecret, address);
    const reservation = await this.quota.reserve({ subjectHash: hash });
    if (!reservation.ok) throw new GuestUploadError(reservation.code, 429);
    const retentionDays = this.config.guestRetentionDays;
    return Object.freeze({
      ...reservation,
      storageId: storage.id,
      retentionDays,
      fileExpiresAt: this.clock.now() + retentionDays * MILLISECONDS_PER_DAY,
    });
  }

  async completeUpload(reservationId) {
    const result = await this.quota.complete({ reservationId });
    if (!result.completed) throw new GuestUploadError('GUEST_RESERVATION_INVALID', 409);
    return result;
  }

  cancelUpload(reservationId) {
    return this.quota.cancel({ reservationId });
  }
}

module.exports = { GuestService, GuestUploadError, trustedClientAddress };
