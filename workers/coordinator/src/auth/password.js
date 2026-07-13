const PBKDF2_ITERATIONS = 600_000;
const SALT_BYTES = 16;
const HASH_BITS = 256;

function bytesToBase64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(String(value));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function timingSafeEqual(left, right) {
  const a = String(left ?? '');
  const b = String(right ?? '');
  const length = Math.max(a.length, b.length, 1);
  let mismatch = a.length === b.length ? 0 : 1;
  for (let index = 0; index < length; index += 1) {
    mismatch |= (a.charCodeAt(index) | 0) ^ (b.charCodeAt(index) | 0);
  }
  return mismatch === 0;
}

async function deriveHash({ cryptoImpl, password, salt, iterations }) {
  const material = await cryptoImpl.subtle.importKey(
    'raw',
    new TextEncoder().encode(String(password)),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  const bits = await cryptoImpl.subtle.deriveBits({
    name: 'PBKDF2',
    hash: 'SHA-256',
    salt: base64ToBytes(salt),
    iterations,
  }, material, HASH_BITS);
  return bytesToBase64(new Uint8Array(bits));
}

export function createPasswordService({ cryptoImpl }) {
  return Object.freeze({
    async createRecord(input) {
      const saltBytes = new Uint8Array(SALT_BYTES);
      cryptoImpl.getRandomValues(saltBytes);
      const salt = bytesToBase64(saltBytes);
      const passwordHash = await deriveHash({
        cryptoImpl,
        password: input.password,
        salt,
        iterations: PBKDF2_ITERATIONS,
      });
      return Object.freeze({
        username: input.username,
        passwordHash,
        salt,
        iterations: PBKDF2_ITERATIONS,
        credVersion: input.credVersion,
      });
    },
    async verify(input, record) {
      const passwordHash = await deriveHash({
        cryptoImpl,
        password: input.password,
        salt: record.salt,
        iterations: record.iterations,
      });
      return timingSafeEqual(passwordHash, record.passwordHash);
    },
  });
}

export function createBootstrapCredentials() {
  return Object.freeze({
    verify(input) {
      return input.bootstrapAuthorized === true;
    },
  });
}
