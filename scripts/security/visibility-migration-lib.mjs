export const VISIBILITY_MARKER_KEY = 'schema:visibility:v1';

import { isDeepStrictEqual } from 'node:util';

const VISIBILITIES = new Set(['public', 'private']);
const UPLOAD_SOURCES = new Set(['guest', 'image-host', 'drive', 'api', 'legacy']);
const ACCESS_FIELDS = Object.freeze(['visibility', 'uploadSource', 'accessVersion']);

async function collectKeys(source) {
  let cursor = null;
  let keys = [];
  do {
    const page = await source.listPage(cursor);
    keys = keys.concat(page.keys);
    cursor = page.cursor;
  } while (cursor);
  return keys;
}

function isFileRecord(key) {
  const metadata = key?.metadata;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return false;
  return Object.hasOwn(metadata, 'fileName') && metadata.folderMarker !== true;
}

function hasValidAccess(metadata) {
  return VISIBILITIES.has(metadata.visibility)
    && UPLOAD_SOURCES.has(metadata.uploadSource)
    && Number.isInteger(metadata.accessVersion)
    && metadata.accessVersion >= 1;
}

function classifyFile(key) {
  if (!isFileRecord(key)) return 'unrelated';
  if (typeof key.metadata.fileName !== 'string' || !key.metadata.fileName.trim()) return 'corrupt';
  const present = ACCESS_FIELDS.filter((field) => Object.hasOwn(key.metadata, field));
  if (present.length === 0) return 'legacy';
  if (present.length !== ACCESS_FIELDS.length) return 'corrupt';
  return hasValidAccess(key.metadata) ? 'explicit' : 'corrupt';
}

function inspect(keys) {
  const files = keys.filter(isFileRecord);
  const classified = files.map((key) => ({ key, state: classifyFile(key) }));
  const corrupt = classified.filter((entry) => entry.state === 'corrupt');
  if (corrupt.length > 0) throw new Error(`VISIBILITY_RECORD_CORRUPT:${corrupt.length}`);
  return Object.freeze({
    total: keys.length,
    files: files.length,
    legacy: classified.filter((entry) => entry.state === 'legacy').map((entry) => entry.key),
    explicit: classified.filter((entry) => entry.state === 'explicit').map((entry) => entry.key),
  });
}

async function readMarker(source, keys) {
  if (!keys.some((key) => key.name === VISIBILITY_MARKER_KEY)) return null;
  const encoded = await source.readValue(VISIBILITY_MARKER_KEY);
  let marker;
  try {
    marker = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
  } catch {
    throw new Error('VISIBILITY_MARKER_CORRUPT');
  }
  if (marker?.version !== 1
    || marker?.complete !== true
    || typeof marker?.barrierGeneration !== 'string'
    || typeof marker?.audience !== 'string') {
    throw new Error('VISIBILITY_MARKER_CORRUPT');
  }
  return marker;
}

function resultOf(inspection, options = {}) {
  return Object.freeze({
    total: inspection.total,
    files: inspection.files,
    legacy: inspection.legacy.length,
    explicit: inspection.explicit.length,
    migrated: options.migrated || 0,
    markerCommitted: options.markerCommitted === true,
  });
}

async function buildWrites(source, records) {
  return Promise.all(records.map(async (record) => Object.freeze({
    name: record.name,
    valueBase64: await source.readValue(record.name),
    expiration: record.expiration,
    metadata: Object.freeze({
      ...record.metadata,
      visibility: 'public',
      uploadSource: 'legacy',
      accessVersion: 1,
    }),
  })));
}

function markerRecord(migrated, proof) {
  const value = JSON.stringify({
    version: 1,
    complete: true,
    migrated,
    barrierGeneration: proof.generation,
    audience: proof.audience,
  });
  return Object.freeze({
    name: VISIBILITY_MARKER_KEY,
    valueBase64: Buffer.from(value).toString('base64'),
    metadata: Object.freeze({ schema: 'visibility', version: 1 }),
  });
}

function requireFreezeProof(proof) {
  const valid = proof?.frozen === true
    && proof.active === 0
    && typeof proof.generation === 'string'
    && proof.generation.length > 0
    && typeof proof.audience === 'string'
    && proof.audience.length > 0;
  if (!valid) throw new Error('VISIBILITY_WRITE_FREEZE_REQUIRED');
  return proof;
}

async function verifyWrites(source, keys, writes) {
  const current = new Map(keys.map((key) => [key.name, key]));
  for (const expected of writes) {
    const actual = current.get(expected.name);
    const sameMetadata = actual && isDeepStrictEqual(actual.metadata, expected.metadata);
    const sameExpiration = (actual?.expiration ?? null) === (expected.expiration ?? null);
    if (!sameMetadata || !sameExpiration) throw new Error('VISIBILITY_VERIFY_FAILED');
    const value = await source.readValue(expected.name);
    if (value !== expected.valueBase64) throw new Error('VISIBILITY_VERIFY_FAILED');
  }
}

export async function executeVisibilityMigration(options) {
  const initialKeys = await collectKeys(options.source);
  const initial = inspect(initialKeys);
  const marker = await readMarker(options.source, initialKeys);
  if (marker && initial.legacy.length > 0) throw new Error('VISIBILITY_MARKER_CONTRADICTS_DATA');
  if (marker) return resultOf(initial, { markerCommitted: true });
  if (!options.apply) return resultOf(initial);
  const freezeProof = requireFreezeProof(options.freezeProof);

  const writes = await buildWrites(options.source, initial.legacy);
  if (writes.length > 0) await options.source.writeRecords(writes);
  const verifiedKeys = await collectKeys(options.source);
  const verified = inspect(verifiedKeys);
  if (verified.legacy.length > 0) throw new Error('VISIBILITY_VERIFY_FAILED');
  await verifyWrites(options.source, verifiedKeys, writes);
  await options.source.writeMarker(markerRecord(writes.length, freezeProof));
  const committedKeys = await collectKeys(options.source);
  if (!await readMarker(options.source, committedKeys)) {
    throw new Error('VISIBILITY_MARKER_VERIFY_FAILED');
  }
  return resultOf(verified, { migrated: writes.length, markerCommitted: true });
}
