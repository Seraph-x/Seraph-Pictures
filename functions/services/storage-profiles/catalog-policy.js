import contractModule from '../../../shared/storage/contracts.cjs';
import policyModule from '../../../shared/storage/profile-policy.cjs';

const { mergeStorageConfig, normalizeStorageItem } = contractModule;
const { applyPerTypeDefault, validateProfileMutation } = policyModule;

function normalizedCandidate(input, defaults = {}) {
  const raw = {
    ...defaults,
    ...input,
    config: Object.freeze({ ...(input.config ?? defaults.config ?? {}) }),
    metadata: Object.freeze({ ...(input.metadata ?? defaults.metadata ?? {}) }),
  };
  const normalized = normalizeStorageItem(raw);
  return Object.freeze({ ...normalized, config: raw.config });
}

export function createProfile({ items, input, id, now }) {
  const sameType = items.filter((item) => item.type === String(input.type || '').toLowerCase());
  const candidate = normalizedCandidate(input, {
    id, enabled: input.enabled !== false,
    isDefault: sameType.length === 0 || input.isDefault === true,
    createdAt: now, updatedAt: now,
  });
  return validateProfileMutation({ items, patch: candidate });
}

export function updateProfile({ items, current, patch, now }) {
  const type = patch.type || current.type;
  const changesType = type !== current.type;
  const config = changesType
    ? { ...(patch.config || {}) }
    : mergeStorageConfig(type, current.config, patch.config || {});
  const firstOfType = changesType && !items.some((item) => item.id !== current.id && item.type === type);
  const candidate = normalizedCandidate({
    ...current, ...patch, type, config, updatedAt: now,
    ...(firstOfType ? { isDefault: true } : {}),
  });
  return validateProfileMutation({ items, current, patch: candidate });
}

export function deleteProfile({ items, current, references = 0 }) {
  validateProfileMutation({ items, current, patch: null, references });
  return Object.freeze(items.filter((item) => item.id !== current.id));
}

export function setProfileDefault({ items, id }) {
  return applyPerTypeDefault({ items, profileId: id });
}
