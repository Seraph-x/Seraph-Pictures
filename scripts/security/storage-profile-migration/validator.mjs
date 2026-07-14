const REQUIRED_STEPS = Object.freeze([
  'backup', 'freeze', 'stage', 'validate', 'activate', 'verify-live', 'write-marker',
]);

function migrationFailure(message) {
  return Object.assign(new Error(message), { code: 'STORAGE_MIGRATION_FAILED' });
}

function validateRuntime(runtime) {
  const profiles = runtime.profiles || [];
  const ids = new Set(profiles.map((item) => item.id));
  if (ids.size !== profiles.length) throw migrationFailure('Duplicate profile ID.');
  const types = new Set(profiles.map((item) => item.type));
  for (const type of types) {
    const typed = profiles.filter((item) => item.type === type);
    if (!typed.some((item) => item.enabled)) throw migrationFailure(`No enabled ${type} profile.`);
    if (typed.filter((item) => item.isDefault).length !== 1) {
      throw migrationFailure(`Invalid default count for ${type}.`);
    }
  }
}

export function validateMigrationPlan(plan) {
  validateRuntime(plan.cloudflare);
  validateRuntime(plan.docker);
  if (JSON.stringify(plan.steps) !== JSON.stringify(REQUIRED_STEPS)) {
    throw migrationFailure('Migration marker ordering is invalid.');
  }
  return plan;
}
