#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { executeStorageProfileMigration } from './storage-profile-migration/executor.mjs';
import { planStorageProfileMigration } from './storage-profile-migration/planner.mjs';
import { readMigrationSource } from './storage-profile-migration/source-reader.mjs';

function readOption(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? String(argv[index + 1] || '') : '';
}

function parseArgs(argv) {
  return Object.freeze({
    apply: argv.includes('--apply'),
    inputPath: readOption(argv, '--input'),
    driverPath: readOption(argv, '--driver'),
    owner: readOption(argv, '--owner') || 'storage-profile-migration',
    token: readOption(argv, '--token'),
    cloudflareBackup: readOption(argv, '--cloudflare-backup'),
    dockerBackup: readOption(argv, '--docker-backup'),
  });
}

function requiredApplyOptions(options) {
  if (!options.driverPath) throw new Error('MIGRATION_DRIVER_REQUIRED');
  if (!options.token) throw new Error('MIGRATION_TOKEN_REQUIRED');
  if (!options.cloudflareBackup || !options.dockerBackup) {
    throw new Error('MIGRATION_BACKUP_REQUIRED');
  }
}

async function loadTargets(options, plan) {
  const driverUrl = pathToFileURL(path.resolve(options.driverPath)).href;
  const driver = await import(driverUrl);
  if (typeof driver.createMigrationTargets !== 'function') {
    throw new Error('MIGRATION_DRIVER_INVALID');
  }
  return driver.createMigrationTargets({ options, plan });
}

async function applyMigration(options, plan) {
  requiredApplyOptions(options);
  const targets = await loadTargets(options, plan);
  const result = await executeStorageProfileMigration({
    plan,
    cloudflare: targets.cloudflare,
    docker: targets.docker,
    owner: options.owner,
    token: options.token,
    backupPaths: {
      cloudflare: options.cloudflareBackup,
      docker: options.dockerBackup,
    },
    verifyBackup: (backups) => fs.existsSync(backups.cloudflare) && fs.existsSync(backups.docker),
  });
  return result;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const source = readMigrationSource({ inputPath: options.inputPath });
  const plan = planStorageProfileMigration(source);
  const result = options.apply ? await applyMigration(options, plan) : { plan };
  const mode = options.apply ? 'apply' : 'dry-run';
  process.stdout.write(`${JSON.stringify({ mode, ...result }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error?.code || error?.message || String(error)}\n`);
  process.exitCode = 1;
});
