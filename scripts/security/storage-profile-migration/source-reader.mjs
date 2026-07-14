import fs from 'node:fs';
import path from 'node:path';

export function readMigrationSource({ inputPath }) {
  const resolved = path.resolve(String(inputPath || ''));
  if (!inputPath || !fs.existsSync(resolved)) {
    throw Object.assign(new Error('MIGRATION_SOURCE_NOT_FOUND'), {
      code: 'MIGRATION_SOURCE_NOT_FOUND',
    });
  }
  const value = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw Object.assign(new Error('MIGRATION_SOURCE_INVALID'), {
      code: 'MIGRATION_SOURCE_INVALID',
    });
  }
  return value;
}
