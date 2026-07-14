import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const COORDINATOR_URL = 'http://127.0.0.1:8791';
const PAGES_URL = 'http://127.0.0.1:4182/login';
const UNBOUND_URL = 'http://127.0.0.1:4183/login';
const START_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 200;
const COMPATIBILITY_DATE = '2026-05-03';
const RUNTIME_PATH = path.resolve('.wrangler/auth-e2e-runtime.json');
const REPO_ROOT = process.cwd();
const WRANGLER_BIN = path.resolve('node_modules/.bin/wrangler');
const UNBOUND_ASSETS = [
  'functions', 'shared', 'login.html', 'favicon.svg', 'favicon.ico', 'logo.png',
  'theme.css', 'theme.js', 'i18n.js', 'claude-theme.css',
  'mobile-refactor.css', 'claude-layout.css',
];
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'k-vault-auth-e2e-'));
const children = [];

function spawnWrangler(args, options) {
  const child = spawn(WRANGLER_BIN, args, {
    cwd: options.cwd ?? REPO_ROOT,
    env: { ...process.env, WRANGLER_LOG_PATH: path.join(tempRoot, options.logName) },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  children.push(child);
  return child;
}

function createUnboundRoot() {
  const root = path.join(tempRoot, 'unbound');
  fs.mkdirSync(root);
  for (const asset of UNBOUND_ASSETS) {
    const source = path.join(REPO_ROOT, asset);
    const target = path.join(root, asset);
    const stat = fs.statSync(source);
    if (stat.isDirectory()) fs.cpSync(source, target, { recursive: true });
    else fs.copyFileSync(source, target);
  }
  fs.symlinkSync(path.join(REPO_ROOT, 'node_modules'), path.join(root, 'node_modules'), 'dir');
  return root;
}

async function waitForUrl(url) {
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      await fetch(url);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  }
  throw new Error(`RUNTIME_START_TIMEOUT:${url}`);
}

function stopChild(child) {
  if (child.exitCode == null && child.signalCode == null) child.kill('SIGTERM');
}

function cleanup() {
  for (const child of children) stopChild(child);
  fs.rmSync(tempRoot, { recursive: true, force: true });
  fs.rmSync(RUNTIME_PATH, { force: true });
}

async function start() {
  const coordinator = spawnWrangler([
    'dev', '--config', 'workers/coordinator/wrangler.jsonc',
    '--ip', '127.0.0.1', '--port', '8791',
    '--inspector-port', '9230',
    '--persist-to', path.join(tempRoot, 'coordinator'),
  ], { logName: 'coordinator.log' });
  await waitForUrl(COORDINATOR_URL);
  const unboundRoot = createUnboundRoot();
  spawnWrangler([
    'pages', 'dev', '.', '--ip', '127.0.0.1', '--port', '4183',
    '--inspector-port', '9232', '--compatibility-date', COMPATIBILITY_DATE,
    '--kv', 'img_url', '--r2', 'R2_BUCKET', '--binding', 'APP_ENV=local',
    '--persist-to', path.join(tempRoot, 'unbound-pages'),
  ], { cwd: unboundRoot, logName: 'unbound-pages.log' });
  await waitForUrl(UNBOUND_URL);
  const pages = spawnWrangler([
    'pages', 'dev', '.', '--ip', '127.0.0.1', '--port', '4182',
    '--inspector-port', '9231',
    '--do', 'AUTH_COORDINATOR=AuthCoordinator@k-vault-coordinator',
    '--kv', 'img_url', '--r2', 'R2_BUCKET',
    '--binding', 'APP_ENV=local',
    '--binding', 'BASIC_USER=admin', '--binding', 'BASIC_PASS=initial-password',
    '--binding', 'WEBAUTHN_RP_ID=localhost',
    '--binding', 'WEBAUTHN_ORIGIN=http://127.0.0.1:4182',
    '--persist-to', path.join(tempRoot, 'pages'),
  ], { logName: 'pages.log' });
  await waitForUrl(PAGES_URL);
  fs.mkdirSync(path.dirname(RUNTIME_PATH), { recursive: true });
  fs.writeFileSync(RUNTIME_PATH, JSON.stringify({
    coordinatorPid: coordinator.pid,
    pagesPid: pages.pid,
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
