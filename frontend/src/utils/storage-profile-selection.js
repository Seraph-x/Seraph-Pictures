export const STORAGE_PROFILE_MEMORY_KEY = 'seraph-storage-profile-selection:v1';
const MEMORY_VERSION = 1;

function selectionError(code) {
  return Object.assign(new Error(code), { code });
}

function normalizeProfiles(profiles) {
  return Array.isArray(profiles) ? profiles : [];
}

export function groupStorageProfiles(profiles) {
  const groups = new Map();
  for (const profile of normalizeProfiles(profiles)) {
    if (!groups.has(profile.type)) groups.set(profile.type, []);
    groups.get(profile.type).push(profile);
  }
  return Object.freeze([...groups.entries()].map(([type, items]) => Object.freeze({
    type,
    profiles: Object.freeze([...items]),
  })));
}

export function enabledProfilesForType(profiles, type) {
  return Object.freeze(normalizeProfiles(profiles).filter((profile) => (
    profile.type === type && profile.enabled
  )));
}

export function defaultProfileForType(profiles, type) {
  return enabledProfilesForType(profiles, type).find((profile) => profile.isDefault) || null;
}

function readMemory(storage) {
  const raw = storage.getItem(STORAGE_PROFILE_MEMORY_KEY);
  if (!raw) return Object.freeze({ version: MEMORY_VERSION, byType: Object.freeze({}) });
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw selectionError('STORAGE_PROFILE_MEMORY_INVALID', error);
  }
  if (parsed?.version !== MEMORY_VERSION || !parsed.byType || Array.isArray(parsed.byType)) {
    throw selectionError('STORAGE_PROFILE_MEMORY_INVALID');
  }
  return Object.freeze({ version: MEMORY_VERSION, byType: Object.freeze({ ...parsed.byType }) });
}

export function readRememberedStorageProfile(storage, type) {
  return String(readMemory(storage).byType[type] || '');
}

export function rememberStorageProfile(storage, type, storageId) {
  const current = readMemory(storage);
  const next = Object.freeze({
    version: MEMORY_VERSION,
    byType: Object.freeze({ ...current.byType, [type]: storageId }),
  });
  storage.setItem(STORAGE_PROFILE_MEMORY_KEY, JSON.stringify(next));
  return next;
}

export function selectStorageProfile({ profiles, type, rememberedId = '' }) {
  const choices = enabledProfilesForType(profiles, type);
  const remembered = choices.find((profile) => profile.id === rememberedId);
  if (remembered) return Object.freeze({ profile: remembered, notice: '' });
  const profile = choices.find((item) => item.isDefault) || null;
  if (!profile) throw selectionError('STORAGE_SELECTION_REQUIRED');
  return Object.freeze({
    profile,
    notice: rememberedId ? 'STORAGE_PROFILE_SELECTION_RESET' : '',
  });
}

export function snapshotStorageTarget({ storageMode, profile, targetFolderPath = '' }) {
  if (!profile?.id || profile.type !== storageMode) throw selectionError('STORAGE_TYPE_MISMATCH');
  return Object.freeze({
    storageMode,
    storageId: profile.id,
    storageName: profile.name,
    targetFolderPath,
  });
}
