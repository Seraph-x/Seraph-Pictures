import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checksumEnvelope,
  collectKeyInventory,
  collectRecords,
  decryptRecords,
  encryptRecords,
  summarizeRecords,
} from './backup-lib.mjs';
import { createCloudflareKvSource } from './cloudflare-kv-source.mjs';

function readValue(argv, index, option) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`OPTION_VALUE_REQUIRED:${option}`);
  return value;
}

export function parseOptions(argv, environment = process.env) {
  const parsed = { dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === '--dry-run') parsed.dryRun = true;
    if (option === '--help') parsed.help = true;
    if (option === '--environment') parsed.environment = readValue(argv, index++, option);
    if (option === '--output') parsed.output = readValue(argv, index++, option);
  }
  return Object.freeze({
    ...parsed,
    accountId: environment.CLOUDFLARE_ACCOUNT_ID,
    namespaceId: environment.KV_NAMESPACE_ID,
    apiToken: environment.CLOUDFLARE_API_TOKEN,
    encryptionKey: environment.BACKUP_ENCRYPTION_KEY,
  });
}

function isInsideRepository(output, repoRoot) {
  const relative = path.relative(path.resolve(repoRoot), path.resolve(output));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function validateOptions(options) {
  if (options.environment !== 'production') throw new Error('PRODUCTION_ENVIRONMENT_REQUIRED');
  if (!options.dryRun && (!options.output || isInsideRepository(options.output, options.repoRoot || process.cwd()))) {
    throw new Error('OUTPUT_OUTSIDE_REPOSITORY_REQUIRED');
  }
  if (!options.dryRun && !options.encryptionKey) throw new Error('BACKUP_ENCRYPTION_KEY_REQUIRED');
  if (!options.accountId) throw new Error('CLOUDFLARE_ACCOUNT_ID_REQUIRED');
  if (!options.namespaceId) throw new Error('KV_NAMESPACE_ID_REQUIRED');
  if (!options.apiToken) throw new Error('CLOUDFLARE_API_TOKEN_REQUIRED');
  return Object.freeze({ ...options, output: options.output ? path.resolve(options.output) : null });
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

async function writeVerifiedBackup({ options, source, logger }) {
  const records = await collectRecords(source);
  const envelope = await encryptRecords({ records, passphrase: options.encryptionKey });
  writeJson(options.output, envelope);
  const storedEnvelope = JSON.parse(fs.readFileSync(options.output, 'utf8'));
  const restored = await decryptRecords({ envelope: storedEnvelope, passphrase: options.encryptionKey });
  if (JSON.stringify(restored) !== JSON.stringify(records)) throw new Error('BACKUP_READBACK_MISMATCH');
  const checksum = checksumEnvelope(storedEnvelope);
  const manifest = { schemaVersion: 1, checksum, ...summarizeRecords(records) };
  writeJson(`${options.output}.manifest.json`, manifest);
  logger(JSON.stringify({ output: options.output, checksum }));
}

export async function executeBackup(rawOptions, dependencies = {}) {
  const options = validateOptions(rawOptions);
  const source = dependencies.source || createCloudflareKvSource(options);
  const logger = dependencies.logger || console.log;
  if (options.dryRun) {
    logger(JSON.stringify(summarizeRecords(await collectKeyInventory(source))));
    return;
  }
  await writeVerifiedBackup({ options, source, logger });
}

function printHelp() {
  process.stdout.write('Usage: node scripts/security/backup-kv-state.mjs --environment production [--dry-run | --output /absolute/path]\n');
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  if (options.help) return printHelp();
  await executeBackup(options);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
