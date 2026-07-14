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

async function read(context) {
  const catalog = await context.store.readActive();
  const items = Object.freeze(await decodeItems(context.env, catalog));
  return Object.freeze({ catalog, items });
}

async function persist(context, options) {
  const { catalog, items, guardedStorageIds = [] } = options;
  const generation = context.generations.create();
  const next = generationCatalog({
    generation,
    items: await encodeItems(context.env, items),
    legacyTypeProfileIds: catalog.legacyTypeProfileIds,
  });
  await context.store.stage(next);
  const activated = await context.store.activate({
    generation,
    expectedGeneration: catalog.generation,
    guardedStorageIds,
  });
  if (!activated?.ok || activated.generation !== generation) {
    throw new StoragePolicyError(activated?.code || 'STORAGE_MIGRATION_FAILED');
  }
}

async function runtimeSnapshot(context) {
  const { catalog, items } = await read(context);
  return Object.freeze({
    generation: catalog.generation,
    items,
    legacyTypeProfileIds: catalog.legacyTypeProfileIds,
  });
}

async function list(context, options = {}) {
  const { items } = await read(context);
  return items.map((item) => publicProfile(item, options.includeSecrets));
}

async function get(context, id, options = {}) {
  const { items } = await read(context);
  const item = items.find((entry) => entry.id === id);
  return item ? publicProfile(item, options.includeSecrets) : null;
}

async function create(context, input) {
  const { catalog, items } = await read(context);
  const created = createProfile({
    items, input, id: context.ids.create(), now: context.clock.now(),
  });
  await persist(context, { catalog, items: [...items, created] });
  return created;
}

async function update(context, id, patch) {
  const { catalog, items } = await read(context);
  const current = items.find((item) => item.id === id);
  if (!current) return null;
  const updated = updateProfile({ items, current, patch, now: context.clock.now() });
  await persist(context, {
    catalog,
    items: items.map((item) => item.id === id ? updated : item),
    guardedStorageIds: updated.type === current.type ? [] : [id],
  });
  return updated;
}

async function remove(context, id) {
  const { catalog, items } = await read(context);
  const current = items.find((item) => item.id === id);
  if (!current) return false;
  await persist(context, {
    catalog, items: deleteProfile({ items, current }), guardedStorageIds: [id],
  });
  return true;
}

async function setDefault(context, id) {
  const { catalog, items } = await read(context);
  if (!items.some((item) => item.id === id)) return null;
  const next = setProfileDefault({ items, id });
  await persist(context, { catalog, items: next });
  return next.find((item) => item.id === id);
}

function repositoryApi(context) {
  return Object.freeze({
    runtimeSnapshot: () => runtimeSnapshot(context),
    list: (options) => list(context, options),
    get: (id, options) => get(context, id, options),
    create: (input) => create(context, input),
    update: (id, patch) => update(context, id, patch),
    delete: (id) => remove(context, id),
    setDefault: (id) => setDefault(context, id),
  });
}

export function createStorageProfileRepository(env, dependencies = {}) {
  return repositoryApi(Object.freeze({
    env,
    store: dependencies.store || createStorageCatalogStore(env),
    ids: dependencies.ids || { create: () => `sc_${crypto.randomUUID()}` },
    generations: dependencies.generations || { create: () => crypto.randomUUID() },
    clock: dependencies.clock || Date,
  }));
}
