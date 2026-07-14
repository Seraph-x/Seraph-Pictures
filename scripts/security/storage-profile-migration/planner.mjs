import crypto from 'node:crypto';
import { validateMigrationPlan } from './validator.mjs';

const STEPS = Object.freeze([
  'backup', 'freeze', 'stage', 'validate', 'activate', 'verify-live', 'write-marker',
]);

function failure(message) {
  return Object.assign(new Error(message), { code: 'STORAGE_MIGRATION_FAILED' });
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function legacyId(type, config) {
  const digest = crypto.createHash('sha256')
    .update(JSON.stringify(stableValue({ type, config })))
    .digest('hex').slice(0, 16);
  return `sc_legacy_${digest}`;
}

function cloneProfile(profile) {
  return {
    ...profile,
    config: { ...(profile.config || {}) },
    metadata: { ...(profile.metadata || {}) },
  };
}

function earliestEnabled(items) {
  return [...items].filter((item) => item.enabled).sort((left, right) => (
    Number(left.createdAt || 0) - Number(right.createdAt || 0)
      || String(left.id).localeCompare(String(right.id))
  ))[0];
}

function normalizeDefaults(profiles) {
  const output = profiles.map(cloneProfile);
  for (const type of new Set(output.map((item) => item.type))) {
    const typed = output.filter((item) => item.type === type);
    const enabled = typed.filter((item) => item.enabled);
    if (enabled.length === 0) throw failure(`No enabled ${type} profile.`);
    const selected = typed.find((item) => item.enabled && item.isDefault) || earliestEnabled(typed);
    for (const item of typed) item.isDefault = item.id === selected.id;
  }
  return output.sort((left, right) => String(left.id).localeCompare(String(right.id)));
}

function cloudflareLegacyProfiles(source, existing) {
  const output = [];
  for (const [type, rawConfig] of Object.entries(source || {}).sort()) {
    if (type.endsWith('Guest') || existing.some((item) => item.type === type)) continue;
    if (!rawConfig || typeof rawConfig !== 'object' || Object.keys(rawConfig).length === 0) continue;
    const config = type === 'r2'
      ? { ...rawConfig, adapterMode: 'binding', bindingName: 'R2_BUCKET' }
      : { ...rawConfig };
    output.push({
      id: legacyId(type, config), name: `${type} (Legacy)`, type,
      enabled: true, isDefault: false, config, metadata: { source: 'legacy-config' },
      createdAt: 0, updatedAt: 0,
    });
  }
  return output;
}

function defaultMap(profiles) {
  return Object.fromEntries(profiles.filter((item) => item.isDefault)
    .map((item) => [item.type, item.id]).sort(([left], [right]) => left.localeCompare(right)));
}

function referenceCounts(profiles, files, legacyTypeProfileIds) {
  const counts = Object.fromEntries(profiles.map((item) => [item.id, 0]));
  for (const file of files || []) {
    const id = file.storageConfigId || legacyTypeProfileIds[file.storageType];
    if (!id || !Object.hasOwn(counts, id)) throw failure(`Unresolved file reference ${file.id}.`);
    counts[id] += 1;
  }
  return counts;
}

function runtimePlan(profiles, files) {
  const normalized = normalizeDefaults(profiles || []);
  const legacyTypeProfileIds = defaultMap(normalized);
  return {
    profiles: normalized,
    legacyTypeProfileIds,
    referenceCounts: referenceCounts(normalized, files, legacyTypeProfileIds),
  };
}

export function planStorageProfileMigration(source) {
  const v1 = source.cloudflare?.v1Catalog?.items || [];
  const cloudflareProfiles = [
    ...v1.map(cloneProfile),
    ...cloudflareLegacyProfiles(source.cloudflare?.legacyConfig, v1),
  ];
  const plan = {
    schemaVersion: 2,
    preferredType: String(source.preferredType || 'telegram').toLowerCase(),
    cloudflare: runtimePlan(cloudflareProfiles, source.cloudflare?.files || []),
    docker: runtimePlan(source.docker?.profiles || [], source.docker?.files || []),
    steps: [...STEPS],
  };
  return validateMigrationPlan(plan);
}
