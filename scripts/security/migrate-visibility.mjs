import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCloudflareKvSource } from './cloudflare-kv-source.mjs';
import { createWranglerKvSource } from './wrangler-kv-source.mjs';
import { executeVisibilityMigration } from './visibility-migration-lib.mjs';

const APPLY_CONFIRMATION = 'MIGRATE_VISIBILITY_V1';
const PRODUCTION_ORIGIN = 'https://pictures.seraphzero.com';

function readValue(argv, index, option) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`OPTION_VALUE_REQUIRED:${option}`);
  return value;
}

export function parseOptions(argv, environment = process.env) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === '--dry-run') parsed.dryRun = true;
    if (option === '--apply') parsed.apply = true;
    if (option === '--wrangler-oauth') parsed.wranglerOauth = true;
    if (option === '--help') parsed.help = true;
    if (option === '--confirm') parsed.confirm = readValue(argv, index++, option);
    if (option === '--freeze-url') parsed.freezeUrl = readValue(argv, index++, option);
    if (option === '--environment') parsed.environment = readValue(argv, index++, option);
  }
  return Object.freeze({
    ...parsed,
    accountId: environment.CLOUDFLARE_ACCOUNT_ID,
    namespaceId: environment.KV_NAMESPACE_ID,
    apiToken: environment.CLOUDFLARE_API_TOKEN,
  });
}

export function validateOptions(options) {
  if (options.environment !== 'production') throw new Error('PRODUCTION_ENVIRONMENT_REQUIRED');
  if (Boolean(options.dryRun) === Boolean(options.apply)) throw new Error('MIGRATION_MODE_REQUIRED');
  if (options.apply && options.confirm !== APPLY_CONFIRMATION) {
    throw new Error('MIGRATION_CONFIRMATION_REQUIRED');
  }
  if (options.apply && !options.freezeUrl) {
    throw new Error('VISIBILITY_WRITE_FREEZE_REQUIRED');
  }
  if (!options.accountId) throw new Error('CLOUDFLARE_ACCOUNT_ID_REQUIRED');
  if (!options.namespaceId) throw new Error('KV_NAMESPACE_ID_REQUIRED');
  if (!options.apiToken && !options.wranglerOauth) throw new Error('CLOUDFLARE_API_TOKEN_REQUIRED');
  return Object.freeze({ ...options });
}

export async function executeCli(rawOptions, dependencies = {}) {
  const options = validateOptions(rawOptions);
  const source = dependencies.source || (options.wranglerOauth
    ? createWranglerKvSource(options)
    : createCloudflareKvSource(options));
  const freezeProof = options.apply
    ? await verifyFreeze({
        rawUrl: options.freezeUrl,
        expectedAudience: options.namespaceId,
        fetchImpl: dependencies.fetchImpl || fetch,
      })
    : null;
  const result = await executeVisibilityMigration({
    source,
    apply: options.apply === true,
    freezeProof,
  });
  (dependencies.logger || console.log)(JSON.stringify(result));
  return result;
}

export async function verifyFreeze(options) {
  const url = new URL('/api/migration-freeze', options.rawUrl);
  if (url.origin !== PRODUCTION_ORIGIN) throw new Error('VISIBILITY_FREEZE_URL_INVALID');
  const response = await options.fetchImpl(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error('VISIBILITY_WRITE_FREEZE_UNVERIFIED');
  const status = await response.json();
  const valid = status?.frozen === true
    && status?.active === 0
    && typeof status?.generation === 'string'
    && status.generation.length > 0
    && status.audience === options.expectedAudience;
  if (!valid) {
    throw new Error('VISIBILITY_WRITE_FREEZE_UNVERIFIED');
  }
  return Object.freeze({ ...status });
}

function printHelp() {
  process.stdout.write([
    'Usage: node scripts/security/migrate-visibility.mjs --environment production',
    ' [--wrangler-oauth] (--dry-run | --apply --confirm MIGRATE_VISIBILITY_V1',
    ' --freeze-url https://deployment.example)\n',
  ].join(''));
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  if (options.help) return printHelp();
  await executeCli(options);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
