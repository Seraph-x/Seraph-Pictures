const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const childProcess = require('node:child_process');

const BASELINE_DIR = path.resolve(__dirname, '../e2e/visual-baselines');
const MANIFEST_PATH = path.join(BASELINE_DIR, 'manifest.json');
const REQUIRED_ROUTES = Object.freeze([
  '/',
  '/login',
  '/admin',
  '/gallery',
  '/preview',
  '/webdav',
  '/storage-settings',
  '/app/drive',
  '/app/storage',
  '/app/status',
]);
const REQUIRED_VIEWPORTS = Object.freeze(['desktop', 'mobile']);
const FEATURE_BASE = '43f46fd';
const APPROVED_CHANGED_ENTRIES = Object.freeze([
  '/::desktop', '/admin::desktop', '/storage-settings::desktop', '/app/drive::desktop',
  '/::mobile', '/admin::mobile', '/storage-settings::mobile', '/app/drive::mobile',
]);

function readManifest() {
  assert.ok(fs.existsSync(MANIFEST_PATH), 'visual baseline manifest must exist');
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
}

function assertArtifact(entry) {
  assert.match(entry.textSha256, /^[a-f0-9]{64}$/);
  assert.ok(Array.isArray(entry.controlRectangles));
  assert.match(entry.screenshotSha256, /^[a-f0-9]{64}$/);
  const screenshotPath = path.join(BASELINE_DIR, entry.screenshot);
  assert.ok(fs.existsSync(screenshotPath));
  const digest = crypto.createHash('sha256').update(fs.readFileSync(screenshotPath)).digest('hex');
  assert.strictEqual(digest, entry.screenshotSha256);
}

describe('immutable pre-phase-two visual baseline', function () {
  it('covers every required route and viewport with verifiable artifacts', function () {
    const manifest = readManifest();
    assert.strictEqual(manifest.schemaVersion, 1);
    assert.ok(manifest.fixtureSha256);

    for (const route of REQUIRED_ROUTES) {
      for (const viewport of REQUIRED_VIEWPORTS) {
        const key = `${route}::${viewport}`;
        assert.ok(manifest.entries[key], `missing visual baseline ${key}`);
        assertArtifact(manifest.entries[key]);
      }
    }
  });

  it('changes only approved multi-profile interface baselines', function () {
    const manifest = readManifest();
    const previous = JSON.parse(childProcess.execFileSync(
      'git', ['show', `${FEATURE_BASE}:e2e/visual-baselines/manifest.json`],
      { cwd: path.resolve(__dirname, '..'), encoding: 'utf8' },
    ));
    const changed = Object.keys(manifest.entries).filter((key) => (
      JSON.stringify(manifest.entries[key]) !== JSON.stringify(previous.entries[key])
    ));
    assert.deepEqual(changed, APPROVED_CHANGED_ENTRIES);

    const visualTest = fs.readFileSync(path.resolve(__dirname, '../e2e/baseline.spec.js'), 'utf8');
    assert.match(visualTest, /data-storage-profile-select/);
    assert.match(visualTest, /data-storage-profile-filter/);
    assert.match(visualTest, /data-migration-storage-profile/);
    assert.match(visualTest, /MAX_PIXEL_DIFF_RATIO = 0\.001/);
  });
});
