const MIGRATION_AUDIENCE = 'storage-profiles';

function migrationError(code) {
  return Object.assign(new Error(code), { code });
}

function assertBackupPath(value) {
  if (typeof value !== 'string' || !value.trim()) throw migrationError('MIGRATION_BACKUP_REQUIRED');
  return value;
}

function migrationIdentity(owner, token) {
  if (typeof owner !== 'string' || !owner.trim() || typeof token !== 'string' || !token.trim()) {
    throw migrationError('MIGRATION_IDENTITY_REQUIRED');
  }
  return Object.freeze({ owner: owner.trim(), token: token.trim() });
}

async function createBackups({ plan, cloudflare, docker, backupPaths, verifyBackup }) {
  const cloudflarePath = await cloudflare.backup({
    plan: plan.cloudflare, path: backupPaths?.cloudflare,
  });
  const dockerPath = await docker.backup({
    plan: plan.docker, path: backupPaths?.docker,
  });
  const backups = Object.freeze({
    cloudflare: assertBackupPath(cloudflarePath),
    docker: assertBackupPath(dockerPath),
  });
  if (verifyBackup && !verifyBackup(backups)) throw migrationError('MIGRATION_BACKUP_MISSING');
  return backups;
}

async function prepareMigration({ plan, cloudflare, docker, identity, freeze, authority }) {
  const staged = await cloudflare.stageCatalog({ plan: plan.cloudflare, freeze, identity });
  await cloudflare.stageLedger({
    generation: staged.generation,
    references: plan.cloudflare.references || [],
    referenceCounts: plan.cloudflare.referenceCounts,
    freeze,
    identity,
  });
  await cloudflare.validateStage({ generation: staged.generation, plan: plan.cloudflare, freeze });
  await docker.apply({ plan: plan.docker, identity });
  return Object.freeze({ authority, generation: staged.generation, activationConfirmed: false });
}

async function activatePrepared({ cloudflare, freeze, state }) {
  let activation;
  try {
    activation = await cloudflare.activate({
      generation: state.generation,
      expectedGeneration: state.authority.generation,
      freezeGeneration: freeze.generation,
      freezeAudience: freeze.audience,
      seedLedger: true,
    });
  } catch (cause) {
    throw Object.assign(migrationError('MIGRATION_ACTIVATION_AMBIGUOUS'), { cause });
  }
  if (!activation?.ok || activation.generation !== state.generation) {
    throw migrationError(activation?.code || 'STORAGE_MIGRATION_FAILED');
  }
  return Object.freeze({ ...state, activationConfirmed: true });
}

async function verifyAndMark({ plan, cloudflare, docker, state, backups }) {
  await cloudflare.verifyLive({ generation: state.generation, plan: plan.cloudflare });
  await docker.verifyLive({ plan: plan.docker });
  await cloudflare.writeMarker({ generation: state.generation, backups });
  await docker.writeMarker({ generation: state.generation, backups });
}

async function releaseSuccess({ cloudflare, docker, freeze, identity }) {
  await cloudflare.freezeEnd({ generation: freeze.generation, markerVerified: true });
  await docker.release(identity);
}

async function recoverFailure({ cloudflare, docker, freeze, state, identity, cause }) {
  if (cause?.code === 'MIGRATION_ACTIVATION_AMBIGUOUS') throw cause;
  const cleanupErrors = [];
  if (state?.activationConfirmed) {
    try {
      await cloudflare.rollback({
        generation: state.authority.generation,
        expectedGeneration: state.generation,
        freezeGeneration: freeze.generation,
        freezeAudience: freeze.audience,
      });
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  try { await cloudflare.freezeAbort({ generation: freeze.generation }); } catch (error) {
    cleanupErrors.push(error);
  }
  try { await docker.release(identity); } catch (error) { cleanupErrors.push(error); }
  if (cleanupErrors.length) throw new AggregateError([cause, ...cleanupErrors], 'MIGRATION_RECOVERY_FAILED');
  throw cause;
}

export async function executeStorageProfileMigration(options) {
  const {
    plan, cloudflare, docker, owner, token, backupPaths, verifyBackup,
  } = options;
  const identity = migrationIdentity(owner, token);
  const backups = await createBackups({ plan, cloudflare, docker, backupPaths, verifyBackup });
  await docker.acquire(identity);
  let freeze;
  let state = null;
  try {
    freeze = await cloudflare.freezeBegin({ audience: MIGRATION_AUDIENCE, identity });
    if (freeze.active !== 0) throw migrationError('ACTIVE_MUTATIONS_REMAIN');
    const authority = await cloudflare.readAuthority({ freeze, identity });
    state = await prepareMigration({ plan, cloudflare, docker, identity, freeze, authority });
    state = await activatePrepared({ cloudflare, freeze, state });
    await verifyAndMark({ plan, cloudflare, docker, state, backups });
    await releaseSuccess({ cloudflare, docker, freeze, identity });
    return Object.freeze({ generation: state.generation, backups });
  } catch (error) {
    if (!freeze) {
      await docker.release(identity);
      throw error;
    }
    return recoverFailure({ cloudflare, docker, freeze, state, identity, cause: error });
  }
}
