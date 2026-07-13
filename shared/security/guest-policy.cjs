const BYTES_PER_MEBIBYTE = 1024 * 1024;

const GUEST_LIMITS = Object.freeze({
  dailyUploads: 10,
  burstUploads: 5,
  burstWindowSeconds: 60,
  maximumFileBytes: 20 * BYTES_PER_MEBIBYTE,
  abandonedReservationSeconds: 60 * 60,
});

const MIME_EXTENSIONS = Object.freeze({
  'image/avif': Object.freeze(['avif']),
  'image/gif': Object.freeze(['gif']),
  'image/jpeg': Object.freeze(['jpg', 'jpeg']),
  'image/png': Object.freeze(['png']),
  'image/webp': Object.freeze(['webp']),
});

const ALLOWED = Object.freeze({ allowed: true, code: null });

const IMAGE_SIGNATURES = Object.freeze([
  Object.freeze({ mime: 'image/png', offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] }),
  Object.freeze({ mime: 'image/jpeg', offset: 0, bytes: [0xff, 0xd8, 0xff] }),
  Object.freeze({ mime: 'image/gif', offset: 0, text: 'GIF87a' }),
  Object.freeze({ mime: 'image/gif', offset: 0, text: 'GIF89a' }),
  Object.freeze({ mime: 'image/webp', offset: 0, text: 'RIFF', suffixOffset: 8, suffix: 'WEBP' }),
]);

function denied(code, status) {
  return Object.freeze({ allowed: false, code, status });
}

function fileExtension(fileName) {
  const match = String(fileName || '').toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] || '';
}

function validByteLength(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function matchesBytes(bytes, signature) {
  return signature.every((value, index) => bytes[index] === value);
}

function readAscii(bytes, offset, length) {
  return String.fromCharCode(...bytes.slice(offset, offset + length));
}

function detectImageMime(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input || 0);
  for (const signature of IMAGE_SIGNATURES) {
    const byteMatch = signature.bytes && matchesBytes(bytes, signature.bytes);
    const textMatch = signature.text
      && readAscii(bytes, signature.offset, signature.text.length) === signature.text;
    if (!byteMatch && !textMatch) continue;
    if (signature.suffix
      && readAscii(bytes, signature.suffixOffset, signature.suffix.length) !== signature.suffix) continue;
    return signature.mime;
  }
  if (readAscii(bytes, 4, 4) !== 'ftyp') return null;
  const brands = [];
  for (let offset = 8; offset + 4 <= Math.min(bytes.length, 40); offset += 4) {
    brands.push(readAscii(bytes, offset, 4));
  }
  return brands.some((brand) => ['avif', 'avis'].includes(brand)) ? 'image/avif' : null;
}

function validateGuestUpload(options) {
  const maximum = Math.min(
    Number(options.maximumFileBytes) || GUEST_LIMITS.maximumFileBytes,
    GUEST_LIMITS.maximumFileBytes,
  );
  if (!validByteLength(options.actualBytes) || options.actualBytes > maximum) {
    return denied('GUEST_FILE_TOO_LARGE', 413);
  }
  if (!validByteLength(options.declaredBytes)
    || options.declaredBytes !== options.actualBytes) {
    return denied('GUEST_SIZE_MISMATCH', 400);
  }
  const mimeType = String(options.mimeType || '').split(';')[0].trim().toLowerCase();
  const detectedMimeType = String(options.detectedMimeType || '').toLowerCase();
  const extensions = MIME_EXTENSIONS[mimeType];
  if (!extensions) return denied('GUEST_MIME_REJECTED', 415);
  if (detectedMimeType !== mimeType) {
    return denied('GUEST_CONTENT_MISMATCH', 415);
  }
  if (!extensions.includes(fileExtension(options.fileName))) {
    return denied('GUEST_CONTENT_MISMATCH', 415);
  }
  if (!Number.isInteger(options.retentionDays) || options.retentionDays < 1) {
    return denied('GUEST_RETENTION_REQUIRED', 500);
  }
  return ALLOWED;
}

module.exports = { GUEST_LIMITS, detectImageMime, validateGuestUpload };
