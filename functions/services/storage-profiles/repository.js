import policyModule from '../../../shared/storage/profile-policy.cjs';
import { createStorageCatalogStore } from './catalog-store.js';
import { decodeProfile, encodeProfile } from './profile-codec.js';
import {
  createProfile, deleteProfile, setProfileDefault, updateProfile,
} from './catalog-policy.js';

const { presentProfile, StoragePolicyError } = policyModule;
const SCHEMA_VERSION = 2;

async function decodeItems(env, catalog) {
  return Promise.all(catalog.items.map((item) => decodeProfile(env, item)));
}

async function encodeItems(env, items) {
  return Promise.all(items.map((item) => encodeProfile(env, item)));
}

function publicProfile(profile, includeSecrets) {
  return includeSecrets ? profile : presentProfile(profile);
}

function generationCatalog({ generation, items, legacyTypeProfileIds }) {
  return Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    generation,
    items: Object.freeze(items),
    legacyTypeProfileIds: Object.freeze({ ...(legacyTypeProfileIds || {}) }),
  });
}

export function createStorageProfileRepository(env, dependencies = {}) {
  const store = dependencies.store || createStorageCatalogStore(env);
  const ids = dependencies.ids || { create: () => `sc_${crypto.randomUUID()}` };
  const generations = dependencies.generations || { create: () => crypto.randomUUID() };
  const clock = dependencies.clock || Date;

  async function read() {
    const catalog = await store.readActive();
    return Object.freeze({ catalog, items: Object.freeze(await decodeItems(env, catalog)) });
  }

  async function persist({ catalog, items, guardedStorageIds = [] }) {
    const generation = generations.create();
    const next = generationCatalog({
      generation,
      items: await encodeItems(env, items),
      legacyTypeProfileIds: catalog.legacyTypeProfileIds,
    });
    await store.stage(next);
    const activated = await store.activate({
      generation,
      expectedGeneration: catalog.generation,
      guardedStorageIds,
    });
    if (!activated?.ok || activated.generation !== generation) {
      throw new StoragePolicyError(activated?.code || 'STORAGE_MIGRATION_FAILED');
    }
  }

  return Object.freeze({
    async list(options = {}) {
      const { items } = await read();
      return items.map((item) => publicProfile(item, options.includeSecrets));
    },
    async get(id, options = {}) {
      const { items } = await read();
      const item = items.find((entry) => entry.id === id);
      return item ? publicProfile(item, options.includeSecrets) : null;
    },
    async create(input) {
      const { catalog, items } = await read();
      const created = createProfile({ items, input, id: ids.create(), now: clock.now() });
      await persist({ catalog, items: [...items, created] });
      return created;
    },
    async update(id, patch) {
      const { catalog, items } = await read();
      const current = items.find((item) => item.id === id);
      if (!current) return null;
      const updated = updateProfile({ items, current, patch, now: clock.now() });
      await persist({
        catalog,
        items: items.map((item) => item.id === id ? updated : item),
        guardedStorageIds: updated.type === current.type ? [] : [id],
      });
      return updated;
    },
    async delete(id) {
      const { catalog, items } = await read();
      const current = items.find((item) => item.id === id);
      if (!current) return false;
      await persist({
        catalog,
        items: deleteProfile({ items, current }),
        guardedStorageIds: [id],
      });
      return true;
    },
    async setDefault(id) {
      const { catalog, items } = await read();
      if (!items.some((item) => item.id === id)) return null;
      const next = setProfileDefault({ items, id });
      await persist({ catalog, items: next });
      return next.find((item) => item.id === id);
    },
  });
}
