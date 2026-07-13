import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const MAX_COMMAND_OUTPUT_BYTES = 128 * 1024 * 1024;
const MAX_PARALLEL_READS = 4;

function createCommandRunner(wranglerBin) {
  return async (args) => {
    const { stdout } = await execFileAsync(wranglerBin, args, {
      encoding: 'buffer',
      maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
      env: { ...process.env, WRANGLER_LOG_PATH: '/tmp/k-vault-backup-wrangler.log' },
    });
    return stdout;
  };
}

function createLimiter(limit) {
  let active = 0;
  const queue = [];
  const release = () => {
    active -= 1;
    queue.shift()?.();
  };
  return async (operation) => {
    if (active >= limit) await new Promise((resolve) => queue.push(resolve));
    active += 1;
    try {
      return await operation();
    } finally {
      release();
    }
  };
}

export function createWranglerKvSource(options) {
  const wranglerBin = options.wranglerBin || path.resolve('node_modules/.bin/wrangler');
  const runCommand = options.runCommand || createCommandRunner(wranglerBin);
  const limit = createLimiter(MAX_PARALLEL_READS);
  const namespaceArgs = ['--remote', '--namespace-id', options.namespaceId];
  return Object.freeze({
    async listPage(cursor) {
      if (cursor) return Object.freeze({ keys: [], cursor: null });
      const output = await runCommand(['kv', 'key', 'list', ...namespaceArgs]);
      const keys = JSON.parse(Buffer.from(output).toString('utf8'));
      if (!Array.isArray(keys)) throw new Error('WRANGLER_KV_LIST_SCHEMA_INVALID');
      return Object.freeze({ keys, cursor: null });
    },
    async readValue(name) {
      const output = await limit(() => runCommand(['kv', 'key', 'get', name, ...namespaceArgs]));
      return Buffer.from(output).toString('base64');
    },
  });
}
