import path from 'node:path';
import { fileURLToPath } from 'node:url';

function parseBaseUrl(argv) {
  const index = argv.indexOf('--base-url');
  if (index < 0 || !argv[index + 1]) throw new Error('BASE_URL_REQUIRED');
  return argv[index + 1];
}

function validateEnvelope(body) {
  if (body?.authRequired !== true || typeof body.authenticated !== 'boolean' || body.error) {
    throw new Error('COORDINATOR_BINDING_PROBE_SCHEMA_INVALID');
  }
}

export async function probeCoordinatorBinding({ baseUrl, fetchImpl = fetch }) {
  const url = new URL('/api/auth/check', baseUrl).href;
  const response = await fetchImpl(url, {
    headers: { Accept: 'application/json' },
    redirect: 'error',
  });
  if (!response.ok) throw new Error(`COORDINATOR_BINDING_PROBE_FAILED:${response.status}`);
  let body;
  try {
    body = await response.json();
  } catch (error) {
    throw new Error('COORDINATOR_BINDING_PROBE_SCHEMA_INVALID', { cause: error });
  }
  validateEnvelope(body);
  return Object.freeze({ binding: 'ok' });
}

function printHelp() {
  process.stdout.write('Usage: node scripts/probe-coordinator-binding.mjs --base-url https://deployment.example\n');
}

async function main() {
  if (process.argv.includes('--help')) return printHelp();
  const result = await probeCoordinatorBinding({ baseUrl: parseBaseUrl(process.argv.slice(2)) });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
