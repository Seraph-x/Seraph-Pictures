#!/usr/bin/env node
import { planStorageProfileMigration } from './storage-profile-migration/planner.mjs';
import { readMigrationSource } from './storage-profile-migration/source-reader.mjs';

function parseArgs(argv) {
  const inputIndex = argv.indexOf('--input');
  return Object.freeze({
    apply: argv.includes('--apply'),
    inputPath: inputIndex >= 0 ? argv[inputIndex + 1] : '',
  });
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.apply) throw new Error('MIGRATION_EXECUTOR_NOT_AVAILABLE');
  const source = readMigrationSource({ inputPath: options.inputPath });
  const plan = planStorageProfileMigration(source);
  process.stdout.write(`${JSON.stringify({ mode: 'dry-run', plan }, null, 2)}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error?.code || error?.message || String(error)}\n`);
  process.exitCode = 1;
}
