const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

describe('legacy app artifact synchronization', function () {
  it('removes stale destination files and copies the exact source tree', async function () {
    const moduleUrl = pathToFileURL(
      path.resolve(__dirname, '../frontend/scripts/sync-directory.mjs')
    ).href;
    const { syncDirectory } = await import(moduleUrl);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seraph-sync-'));
    const source = path.join(root, 'source');
    const destination = path.join(root, 'destination');
    fs.mkdirSync(path.join(source, 'assets'), { recursive: true });
    fs.mkdirSync(path.join(destination, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(source, 'index.html'), 'current');
    fs.writeFileSync(path.join(source, 'assets', 'current.js'), 'current');
    fs.writeFileSync(path.join(destination, 'assets', 'stale.js'), 'stale');

    try {
      syncDirectory(source, destination);
      assert.strictEqual(fs.readFileSync(path.join(destination, 'index.html'), 'utf8'), 'current');
      assert.deepStrictEqual(fs.readdirSync(path.join(destination, 'assets')), ['current.js']);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
