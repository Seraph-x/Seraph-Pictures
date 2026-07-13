import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const START_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 200;
const REPO_ROOT = process.cwd();
const WRANGLER_BIN = path.resolve('node_modules/.bin/wrangler');
const RUNTIME_PATH = path.resolve('.wrangler/storage-e2e-runtime.json');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'k-vault-storage-e2e-'));
const children = [];

function startProcess(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: REPO_ROOT,
    env: { ...process.env, ...options.env },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  children.push(child);
  return child;
}

function startWrangler(args, logName) {
  return startProcess(WRANGLER_BIN, args, {
    env: { WRANGLER_LOG_PATH: path.join(tempRoot, logName) },
  });
}

async function waitFor(url) {
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      await fetch(url);
      return;
    } catch {
      // The child process has not opened its listener yet.
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(`RUNTIME_START_TIMEOUT:${url}`);
}

function stop(child) {
  if (child.exitCode == null && child.signalCode == null) child.kill('SIGTERM');
}

function cleanup() {
  children.forEach(stop);
  fs.rmSync(tempRoot, { recursive: true, force: true });
  fs.rmSync(RUNTIME_PATH, { force: true });
}

async function start() {
  const coordinator = startWrangler([
    'dev', '--config', 'workers/coordinator/wrangler.jsonc',
    '--ip', '127.0.0.1', '--port', '8792', '--inspector-port', '9240',
    '--persist-to', path.join(tempRoot, 'coordinator'),
  ], 'coordinator.log');
  await waitFor('http://127.0.0.1:8792');

  const pages = startWrangler([
    'pages', 'dev', '.', '--ip', '127.0.0.1', '--port', '4184', '--inspector-port', '9241',
    '--do', 'AUTH_COORDINATOR=AuthCoordinator@k-vault-coordinator',
    '--do', 'UPLOAD_COORDINATOR=UploadCoordinator@k-vault-coordinator',
    '--kv', 'img_url', '--r2', 'R2_BUCKET',
    '--binding', 'APP_ENV=local', '--binding', 'AUTH_DISABLED=true',
    '--binding', 'CONFIG_ENCRYPTION_KEY=storage-e2e-encryption-key',
    '--persist-to', path.join(tempRoot, 'pages'),
  ], 'pages.log');

  const dockerData = path.join(tempRoot, 'docker');
  const docker = startProcess(process.execPath, ['server/index.js'], {
    env: {
      PORT: '4185', NODE_ENV: 'test', AUTH_DISABLED: 'true', DATA_DIR: dockerData,
      DB_PATH: path.join(dockerData, 'runtime.db'), SETTINGS_STORE: 'sqlite',
      CONFIG_ENCRYPTION_KEY: 'storage-e2e-encryption-key',
      SESSION_SECRET: 'storage-e2e-session-secret', TG_BOT_TOKEN: '', TG_CHAT_ID: '',
    },
  });
  await Promise.all([
    waitFor('http://127.0.0.1:4184/api/auth/check'),
    waitFor('http://127.0.0.1:4185/api/auth/check'),
  ]);
  fs.mkdirSync(path.dirname(RUNTIME_PATH), { recursive: true });
  fs.writeFileSync(RUNTIME_PATH, JSON.stringify({
    coordinatorPid: coordinator.pid, pagesPid: pages.pid, dockerPid: docker.pid,
  }));
}

process.once('SIGINT', () => { cleanup(); process.exit(130); });
process.once('SIGTERM', () => { cleanup(); process.exit(143); });
process.once('exit', cleanup);

start().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  cleanup();
  process.exitCode = 1;
});
