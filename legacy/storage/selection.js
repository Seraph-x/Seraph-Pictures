{
  'use strict';

  function storageCloneProfile(profile) {
    if (!profile) return null;
    return Object.freeze({
      ...profile,
      config: Object.freeze({ ...(profile.config || {}) }),
      secretsPresent: Object.freeze({ ...(profile.secretsPresent || {}) }),
    });
  }

  function storageStatusLabel(profile) {
    const labels = [];
    if (profile.isDefault) labels.push('default');
    labels.push(profile.enabled ? 'enabled' : 'disabled');
    return `${profile.name} · ${labels.join(' · ')}`;
  }

  function storageOptionView(profile) {
    return Object.freeze({
      id: profile.id,
      name: profile.name,
      label: storageStatusLabel(profile),
      enabled: Boolean(profile.enabled),
      isDefault: Boolean(profile.isDefault),
    });
  }

  function storageProfilesForType(profiles, type) {
    return (Array.isArray(profiles) ? profiles : [])
      .filter((profile) => profile.type === type)
      .map(storageCloneProfile);
  }

  function buildTypeSelection(options) {
    const matches = storageProfilesForType(options.profiles, options.type);
    const selected = matches.find((item) => item.id === options.selectedId)
      || matches.find((item) => item.isDefault)
      || matches[0]
      || null;
    return Object.freeze({
      type: options.type,
      selected,
      options: Object.freeze(matches.map(storageOptionView)),
    });
  }

  function reconcileSelections(options) {
    const next = {};
    for (const type of options.types) {
      const selected = buildTypeSelection({
        profiles: options.profiles,
        type,
        selectedId: options.selectedByType[type],
      }).selected;
      next[type] = selected?.id || '';
    }
    return Object.freeze(next);
  }

  const legacyStorageSelection = Object.freeze({
    buildTypeSelection,
    cloneProfile: storageCloneProfile,
    reconcileSelections,
  });
  if (typeof module === 'object' && module.exports) module.exports = legacyStorageSelection;
  globalThis.LegacyStorageSelection = legacyStorageSelection;
}
