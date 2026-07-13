const BYTES_PER_MEBIBYTE = 1024 * 1024;

const GUEST_LIMITS = Object.freeze({
  dailyUploads: 10,
  burstUploads: 5,
  burstWindowSeconds: 60,
  maximumFileBytes: 20 * BYTES_PER_MEBIBYTE,
  abandonedReservationSeconds: 60 * 60,
});

module.exports = { GUEST_LIMITS };
