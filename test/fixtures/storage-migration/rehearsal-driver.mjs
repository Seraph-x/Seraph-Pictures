import crypto from 'node:crypto';
import fs from 'node:fs';
import { DatabaseSync, backup } from 'node:sqlite';

function requiredPath(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}

function readJson(filePath) {
  const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('REHEARSAL_STATE_INVALID');
  }
  return value;
}

function writeJson(filePath, value) {
  const temporary = `${filePath}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, filePath);
}

function planGeneration(plan) {
  const digest = crypto.createHash('sha256').update(JSON.stringify(plan)).digest('hex');
  return `generation-${digest.slice(0, 16)}`;
}

function createCloudflareTarget(filePath) {
  function mutate(mutator) {
    const state = readJson(filePath);
    const result = mutator(state);
    writeJson(filePath, state);
    return result;
  }

  return Object.freeze({
    backup: async ({ path }) => {
      fs.copyFileSync(filePath, path);
      return path;
    },
    freezeBegin: async ({ audience }) => mutate((state) => {
      if (state.freeze) throw new Error('MIGRATION_FREEZE_ALREADY_HELD');
      state.freeze = { generation: 'freeze-rehearsal', audience };
      return { ...state.freeze, active: Number(state.activeUploads || 0) };
    }),
    readAuthority: async () => readJson(filePath).authority,
    stageCatalog: async ({ plan }) => mutate((state) => {
      const generation = planGeneration(plan);
      state.catalogs[generation] = plan;
      return { generation };
    }),
    stageLedger: async (input) => mutate((state) => {
      state.ledgers[input.generation] = {
        references: input.references,
        referenceCounts: input.referenceCounts,
      };
    }),
    validateStage: async ({ generation, plan }) => {
      const state = readJson(filePath);
      if (JSON.stringify(state.catalogs[generation]) !== JSON.stringify(plan)) {
        throw new Error('REHEARSAL_CATALOG_STAGE_INVALID');
      }
      if (!state.ledgers[generation]) throw new Error('REHEARSAL_LEDGER_STAGE_MISSING');
    },
    activate: async (input) => mutate((state) => {
      if (state.authority.generation === input.generation) {
        return { ok: true, generation: input.generation };
      }
      if (state.authority.generation !== input.expectedGeneration) {
        return { ok: false, code: 'STORAGE_MIGRATION_FAILED' };
      }
      state.rollbackPointer = state.authority.generation;
      state.authority = { initialized: true, generation: input.generation };
      return { ok: true, generation: input.generation };
    }),
    verifyLive: async ({ generation, plan }) => {
      const state = readJson(filePath);
      if (state.authority.generation !== generation) throw new Error('REHEARSAL_GENERATION_INVISIBLE');
      if (JSON.stringify(state.catalogs[generation]) !== JSON.stringify(plan)) {
        throw new Error('REHEARSAL_LIVE_CATALOG_MISMATCH');
      }
    },
    writeMarker: async ({ generation, backups }) => mutate((state) => {
      state.marker = { generation, backups };
    }),
    rollback: async (input) => mutate((state) => {
      if (state.authority.generation !== input.expectedGeneration) {
        throw new Error('REHEARSAL_ROLLBACK_POINTER_MISMATCH');
      }
      state.authority = { initialized: Boolean(input.generation), generation: input.generation };
    }),
    freezeEnd: async ({ generation, markerVerified }) => mutate((state) => {
      if (!markerVerified || state.freeze?.generation !== generation) {
        throw new Error('REHEARSAL_UNFREEZE_REJECTED');
      }
      state.freeze = null;
    }),
    freezeAbort: async ({ generation }) => mutate((state) => {
      if (state.freeze?.generation !== generation) throw new Error('REHEARSAL_FREEZE_OWNER_MISMATCH');
      state.freeze = null;
    }),
  });
}

function initializeDocker(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS migration_lock (owner TEXT PRIMARY KEY, token TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS active_uploads (id TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS storage_profiles (
      id TEXT PRIMARY KEY, type TEXT NOT NULL, is_default INTEGER NOT NULL, payload TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS storage_references (
      operation_id TEXT PRIMARY KEY, storage_id TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS migration_marker (
      key TEXT PRIMARY KEY, generation TEXT NOT NULL, backups TEXT NOT NULL
    );
  `);
}

function applyDockerPlan(database, plan) {
  const insertProfile = database.prepare(
    'INSERT INTO storage_profiles (id, type, is_default, payload) VALUES (?, ?, ?, ?)',
  );
  const insertReference = database.prepare(
    'INSERT INTO storage_references (operation_id, storage_id) VALUES (?, ?)',
  );
  database.exec('BEGIN IMMEDIATE');
  try {
    database.exec('DELETE FROM storage_references; DELETE FROM storage_profiles;');
    for (const profile of plan.profiles) {
      insertProfile.run(profile.id, profile.type, profile.isDefault ? 1 : 0, JSON.stringify(profile));
    }
    for (const reference of plan.references) {
      insertReference.run(reference.operationId, reference.storageId);
    }
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

function verifyDockerPlan(database, plan) {
  const profiles = database.prepare('SELECT COUNT(*) AS count FROM storage_profiles').get().count;
  const references = database.prepare('SELECT COUNT(*) AS count FROM storage_references').get().count;
  if (profiles !== plan.profiles.length || references !== plan.references.length) {
    throw new Error('REHEARSAL_DOCKER_VERIFY_FAILED');
  }
}

function createDockerTarget(filePath) {
  const database = new DatabaseSync(filePath);
  initializeDocker(database);
  return Object.freeze({
    backup: async ({ path }) => {
      await backup(database, path);
      return path;
    },
    acquire: async (identity) => {
      const active = database.prepare('SELECT COUNT(*) AS count FROM active_uploads').get().count;
      if (active !== 0) throw new Error('ACTIVE_MUTATIONS_REMAIN');
      const existing = database.prepare('SELECT token FROM migration_lock WHERE owner = ?').get(identity.owner);
      if (existing && existing.token !== identity.token) throw new Error('MIGRATION_LOCKED');
      database.prepare('INSERT OR IGNORE INTO migration_lock (owner, token) VALUES (?, ?)')
        .run(identity.owner, identity.token);
    },
    apply: async ({ plan }) => applyDockerPlan(database, plan),
    verifyLive: async ({ plan }) => verifyDockerPlan(database, plan),
    writeMarker: async ({ generation, backups }) => {
      database.prepare('INSERT OR REPLACE INTO migration_marker VALUES (?, ?, ?)')
        .run('storage-profiles-v2', generation, JSON.stringify(backups));
    },
    release: async (identity) => {
      database.prepare('DELETE FROM migration_lock WHERE owner = ? AND token = ?')
        .run(identity.owner, identity.token);
    },
  });
}

export function createMigrationTargets() {
  const cloudflarePath = requiredPath('STORAGE_MIGRATION_REHEARSAL_CF_STATE');
  const dockerPath = requiredPath('STORAGE_MIGRATION_REHEARSAL_DOCKER_STATE');
  return Object.freeze({
    cloudflare: createCloudflareTarget(cloudflarePath),
    docker: createDockerTarget(dockerPath),
  });
}
