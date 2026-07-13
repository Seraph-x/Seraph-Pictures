#!/usr/bin/env node

const { spawnSync } = require('node:child_process');

function runCommand(command, args) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    shell: false,
  });

  return {
    code: Number(result.status == null ? 1 : result.status),
    stdout: String(result.stdout || '').trim(),
    stderr: String(result.stderr || '').trim(),
    error: result.error || null,
  };
}

function runComposeExec(script) {
  return runCommand('docker', ['compose', 'exec', '-T', 'api', 'sh', '-lc', script]);
}

function runComposeNode(script) {
  return runCommand('docker', ['compose', 'exec', '-T', 'api', 'node', '-e', script]);
}

function parseJson(text) {
  try {
    return JSON.parse(String(text || ''));
  } catch {
    return null;
  }
}

function sleepMs(ms) {
  const timeout = Math.max(0, Number(ms) || 0);
  if (timeout === 0) return;
  spawnSync(process.execPath, ['-e', `setTimeout(() => {}, ${timeout})`], {
    stdio: 'ignore',
  });
}

function waitForApi(maxAttempts = 60, intervalMs = 2000) {
  for (let i = 0; i < maxAttempts; i += 1) {
    const health = runComposeExec('wget -qO- http://localhost:8787/api/health');
    if (health.code === 0) {
      return true;
    }
    sleepMs(intervalMs);
  }
  return false;
}

function readStatus() {
  const script = [
    'const credentials = `${process.env.BASIC_USER}:${process.env.BASIC_PASS}`;',
    "const authorization = Buffer.from(credentials).toString('base64');",
    "fetch('http://localhost:8787/api/status', {",
    '  headers: { Authorization: `Basic ${authorization}` },',
    '}).then(async (response) => {',
    '  process.stdout.write(await response.text());',
    '  if (!response.ok) process.exitCode = 1;',
    '});',
  ].join('\n');
  const response = runComposeNode(script);
  if (response.code !== 0) {
    return { ok: false, error: response.stderr || response.stdout || 'status request failed', data: null };
  }

  const parsed = parseJson(response.stdout);
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, error: 'status response is not valid JSON', data: null };
  }

  return { ok: true, error: '', data: parsed };
}

function readProfileTypes() {
  const script = "node -e \"const { createContainer }=require('./lib/container'); const c=createContainer(process.env); console.log(JSON.stringify(c.storageRepo.list(false).map(x=>x.type)));\"";
  const response = runComposeExec(script);
  if (response.code !== 0) {
    return { ok: false, error: response.stderr || response.stdout || 'profile query failed', types: [] };
  }

  const parsed = parseJson(response.stdout);
  if (!Array.isArray(parsed)) {
    return { ok: false, error: 'profile query returned invalid JSON', types: [] };
  }

  return { ok: true, error: '', types: parsed };
}

function assertConfigured(status, key, errors) {
  const item = status[key] || {};
  if (item.configured !== true) {
    errors.push(key + ' should be configured=true, got configured=' + String(item.configured));
  }
  if (item.enabled !== true) {
    errors.push(key + ' should be enabled=true, got enabled=' + String(item.enabled));
  }
}

function validateSmokeData(status, profileTypes) {
  const errors = [];
  assertConfigured(status, 'huggingface', errors);
  assertConfigured(status, 'github', errors);
  const typeSet = new Set(profileTypes);
  if (!typeSet.has('huggingface')) errors.push('storage profile list is missing huggingface');
  if (!typeSet.has('github')) errors.push('storage profile list is missing github');
  return errors;
}

function statusSnapshot(status, profileTypes) {
  return JSON.stringify({
    huggingface: status.huggingface,
    github: status.github,
    profileTypes,
  }, null, 2);
}

function requireSmokeData() {
  const composePs = runCommand('docker', ['compose', 'ps']);
  if (composePs.code !== 0) {
    throw new Error('docker compose ps failed: ' + (composePs.stderr || composePs.stdout));
  }
  if (!waitForApi()) throw new Error('API did not become ready in time.');
  const statusResult = readStatus();
  if (!statusResult.ok) throw new Error('Failed to read /api/status: ' + statusResult.error);
  const profileResult = readProfileTypes();
  if (!profileResult.ok) {
    throw new Error('Failed to inspect storage profiles: ' + profileResult.error);
  }
  return { status: statusResult.data, profileTypes: profileResult.types };
}

function main() {
  process.stdout.write('Running Docker CI smoke checks for storage bootstrap...\n');
  try {
    const { status, profileTypes } = requireSmokeData();
    const errors = validateSmokeData(status, profileTypes);
    const snapshot = statusSnapshot(status, profileTypes);
    if (errors.length > 0) {
      throw new Error('Docker CI smoke checks failed:\n- '
        + errors.join('\n- ') + '\nStatus snapshot:\n' + snapshot);
    }
    process.stdout.write('Docker CI smoke checks passed.\n' + snapshot + '\n');
  } catch (error) {
    process.stderr.write(error.message + '\n');
    process.exit(2);
  }
}

main();
