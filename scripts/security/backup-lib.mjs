import crypto from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const BACKUP_SCHEMA_VERSION = 1;
const CATEGORY_RULES = Object.freeze([
  ['credentials', (name) => name === 'admin_credentials' || name.startsWith('webauthn:')],
  ['storageConfig', (name) => name === 'storage_config' || name.startsWith('storage_config:')],
  ['guestConfig', (name) => name === 'guest_config' || name.startsWith('guest_config:')],
  ['schema', (name) => name.includes('schema') || name.includes('version')],
  ['sessions', (name) => name.startsWith('session:')],
  ['fileMetadata', (name) => !name.startsWith('session:')],
]);

function deriveKey(passphrase, salt) {
  if (!passphrase) throw new Error('BACKUP_PASSPHRASE_REQUIRED');
  return crypto.scryptSync(passphrase, salt, KEY_BYTES);
}

function encode(value) {
  return Buffer.from(value).toString('base64');
}

function decode(value) {
  return Buffer.from(value, 'base64');
}

function countCategories(records) {
  return Object.fromEntries(CATEGORY_RULES.map(([category, matches]) => [
    category,
    records.filter((record) => matches(record.name)).length,
  ]));
}

export async function collectRecords(source) {
  let cursor = null;
  let records = [];
  do {
    const page = await source.listPage(cursor);
    const pageRecords = await Promise.all(page.keys.map(async (key) => Object.freeze({
      name: key.name,
      valueBase64: await source.readValue(key.name),
      metadata: key.metadata ?? null,
    })));
    records = records.concat(pageRecords);
    cursor = page.cursor;
  } while (cursor);
  return records;
}

export async function collectKeyInventory(source) {
  let cursor = null;
  let keys = [];
  do {
    const page = await source.listPage(cursor);
    keys = keys.concat(page.keys.map((key) => Object.freeze({ name: key.name })));
    cursor = page.cursor;
  } while (cursor);
  return keys;
}

export function summarizeRecords(records) {
  return Object.freeze({ total: records.length, categories: countCategories(records) });
}

export async function encryptRecords({ records, passphrase }) {
  const salt = crypto.randomBytes(SALT_BYTES);
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, deriveKey(passphrase, salt), iv);
  const plaintext = Buffer.from(JSON.stringify(records));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Object.freeze({
    schemaVersion: BACKUP_SCHEMA_VERSION,
    algorithm: ALGORITHM,
    salt: encode(salt),
    iv: encode(iv),
    authTag: encode(cipher.getAuthTag()),
    ciphertext: encode(ciphertext),
  });
}

export async function decryptRecords({ envelope, passphrase }) {
  try {
    const salt = decode(envelope.salt);
    const decipher = crypto.createDecipheriv(ALGORITHM, deriveKey(passphrase, salt), decode(envelope.iv));
    decipher.setAuthTag(decode(envelope.authTag));
    const plaintext = Buffer.concat([
      decipher.update(decode(envelope.ciphertext)),
      decipher.final(),
    ]);
    return JSON.parse(plaintext.toString('utf8'));
  } catch (error) {
    throw new Error('BACKUP_DECRYPT_FAILED', { cause: error });
  }
}

export function checksumEnvelope(envelope) {
  return crypto.createHash('sha256').update(JSON.stringify(envelope)).digest('hex');
}
