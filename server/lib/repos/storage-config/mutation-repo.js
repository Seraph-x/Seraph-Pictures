const { run, transaction } = require('../../../db');
const { encryptJson } = require('../../utils/crypto');
const {
  applyPerTypeDefault,
  validateProfileMutation,
} = require('../../../../shared/storage/profile-policy.cjs');

class StorageConfigMutationRepository {
  constructor(options) {
    Object.assign(this, options);
  }

  create(input) {
    return transaction(this.db, () => {
      this.lock.assertUnlocked();
      const items = this.queries.list(true);
      const sameType = items.filter((item) => item.type === input.type);
      const enabled = input.enabled !== false;
      const candidate = validateProfileMutation({
        items,
        patch: {
          ...input,
          enabled,
          id: this.ids.create(),
          isDefault: sameType.length === 0 || input.isDefault === true,
        },
      });
      this.insert(candidate);
      return this.queries.getById(candidate.id, true);
    });
  }

  update(id, patch) {
    return transaction(this.db, () => {
      this.lock.assertUnlocked();
      const current = this.queries.getById(id, true);
      if (!current) return null;
      const changesType = patch.type && patch.type !== current.type;
      const config = changesType
        ? { ...(patch.config || {}) }
        : this.mergeConfig(current.type, current.config, patch.config || {});
      const items = this.queries.list(true);
      const firstOfType = changesType && !items.some((item) => item.id !== id && item.type === patch.type);
      const candidate = validateProfileMutation({
        items,
        current,
        patch: { ...patch, config, ...(firstOfType ? { isDefault: true } : {}) },
        references: this.references.countForProfile(id),
      });
      this.updateRow(candidate);
      return this.queries.getById(id, true);
    });
  }

  delete(id) {
    return transaction(this.db, () => {
      this.lock.assertUnlocked();
      const current = this.queries.getById(id, true);
      if (!current) return false;
      validateProfileMutation({
        items: this.queries.list(true), current, patch: null,
        references: this.references.countForProfile(id),
      });
      return Number(run(this.db, 'DELETE FROM storage_configs WHERE id = ?', [id]).changes || 0) > 0;
    });
  }

  setDefault(id) {
    return transaction(this.db, () => {
      this.lock.assertUnlocked();
      const items = this.queries.list(true);
      const updated = applyPerTypeDefault({ items, profileId: id });
      const selected = updated.find((item) => item.id === id);
      run(this.db, `UPDATE storage_configs SET is_default = 0
        WHERE type = ? AND id != ?`, [selected.type, id]);
      run(this.db, `UPDATE storage_configs SET is_default = 1, updated_at = ?
        WHERE id = ?`, [this.clock.now(), id]);
      return this.queries.getById(id, true);
    });
  }

  insert(profile) {
    const now = this.clock.now();
    run(this.db, `INSERT INTO storage_configs(
      id, name, type, encrypted_payload, is_default, enabled, metadata_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, this.rowValues(profile, now, now));
  }

  updateRow(profile) {
    run(this.db, `UPDATE storage_configs SET name = ?, type = ?, encrypted_payload = ?,
      is_default = ?, enabled = ?, metadata_json = ?, updated_at = ? WHERE id = ?`, [
      profile.name,
      profile.type,
      JSON.stringify(encryptJson(profile.config, this.encryptionKey)),
      profile.isDefault ? 1 : 0,
      profile.enabled ? 1 : 0,
      JSON.stringify(profile.metadata || {}),
      this.clock.now(),
      profile.id,
    ]);
  }

  rowValues(profile, createdAt, updatedAt) {
    return [
      profile.id, profile.name, profile.type,
      JSON.stringify(encryptJson(profile.config, this.encryptionKey)),
      profile.isDefault ? 1 : 0, profile.enabled ? 1 : 0,
      JSON.stringify(profile.metadata || {}), createdAt, updatedAt,
    ];
  }
}

module.exports = { StorageConfigMutationRepository };
