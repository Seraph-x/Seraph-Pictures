const crypto = require('node:crypto');

function asString(value) {
  if (value == null) return '';
  return String(value);
}

function base64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function getSharePayload({ fileId, expiresAt, accessVersion }) {
  return `${asString(fileId)}:${Number(expiresAt || 0)}:${Number(accessVersion || 0)}`;
}

function signSharePayload(payload, secret) {
  return base64url(
    crypto.createHmac('sha256', asString(secret)).update(payload).digest()
  );
}

function createShareSignature({ fileId, expiresAt, accessVersion, secret }) {
  return signSharePayload(getSharePayload({ fileId, expiresAt, accessVersion }), secret);
}

function verifyShareSignature({ fileId, expiresAt, accessVersion, signature, secret }) {
  const actual = asString(signature);
  if (!actual) return false;

  const expected = createShareSignature({ fileId, expiresAt, accessVersion, secret });
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) return false;
  return crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

module.exports = {
  createShareSignature,
  verifyShareSignature,
};
