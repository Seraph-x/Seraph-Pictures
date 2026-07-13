const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const NODE_SQLITE_MAJOR_VERSION = '22';

function readWorkflow() {
  return fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'ci-test.yml'), 'utf8');
}

function readNodeVersion() {
  return fs.readFileSync(path.join(repoRoot, '.node-version'), 'utf8').trim();
}

function readPagesWorkflow() {
  return fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'pages-deploy.yml'), 'utf8');
}

function readPagesConfig() {
  return fs.readFileSync(path.join(repoRoot, 'wrangler.jsonc'), 'utf8');
}

describe('CI workflow contract', function () {
  it('runs on pull requests and pushes to main', function () {
    const workflow = readWorkflow();

    assert.match(workflow, /pull_request:[\s\S]*branches:\s*\[\s*main\s*\]/);
    assert.match(workflow, /push:[\s\S]*branches:\s*\[\s*main\s*\]/);
  });

  it('uses reproducible install, builds dist, then runs the test suite', function () {
    const workflow = readWorkflow();
    const installIndex = workflow.indexOf('run: npm ci');
    const buildIndex = workflow.indexOf('run: npm run build');
    const testIndex = workflow.indexOf('run: npm test');

    assert.notStrictEqual(installIndex, -1, 'workflow should use npm ci');
    assert.notStrictEqual(buildIndex, -1, 'workflow should build before tests');
    assert.notStrictEqual(testIndex, -1, 'workflow should run npm test');
    assert.ok(installIndex < buildIndex, 'npm ci should run before build');
    assert.ok(buildIndex < testIndex, 'build should run before tests');
    assert.doesNotMatch(workflow, /run:\s*npm install/);
    assert.doesNotMatch(workflow, /run:\s*npm run ci-test/);
  });

  it('uses current GitHub actions and an explicit timeout', function () {
    const workflow = readWorkflow();

    assert.match(workflow, /uses:\s*actions\/checkout@v4/);
    assert.match(workflow, /uses:\s*actions\/setup-node@v4/);
    assert.match(workflow, /timeout-minutes:\s*\d+/);
  });

  it('uses the repository Node runtime version for tests', function () {
    const workflow = readWorkflow();
    const nodeVersion = readNodeVersion();

    assert.match(workflow, /node-version-file:\s*['"]?\.node-version['"]?/);
    assert.doesNotMatch(workflow, /node-version:\s*['"]?20['"]?/);
    assert.strictEqual(nodeVersion, NODE_SQLITE_MAJOR_VERSION);
  });

  it('binds Pages to the external auth coordinator namespace', function () {
    const config = readPagesConfig();

    assert.match(config, /"name"\s*:\s*"AUTH_COORDINATOR"[\s\S]*?"class_name"\s*:\s*"AuthCoordinator"[\s\S]*?"script_name"\s*:\s*"k-vault-coordinator"/);
  });

  it('deploys coordinator and probes both preview and production Pages', function () {
    const workflow = readPagesWorkflow();
    const coordinatorIndex = workflow.lastIndexOf('wrangler deploy --config workers/coordinator/wrangler.jsonc');
    const previewIndex = workflow.indexOf('--branch=security-2a0-candidate');
    const previewProbeIndex = workflow.indexOf('probe-coordinator-binding.mjs');
    const productionIndex = workflow.indexOf('--branch=main');
    const productionProbeIndex = workflow.indexOf('probe-coordinator-binding.mjs', previewProbeIndex + 1);

    assert.ok(coordinatorIndex >= 0, 'coordinator deploy must exist');
    assert.ok(previewIndex > coordinatorIndex, 'preview deploy must follow coordinator');
    assert.ok(previewProbeIndex > previewIndex, 'runtime probe must follow preview deploy');
    assert.ok(productionIndex > previewProbeIndex, 'production deploy must follow preview probe');
    assert.ok(productionProbeIndex > productionIndex, 'runtime probe must follow production deploy');
  });

  it('blocks production mutation behind tests, dry-runs, E2E, and encrypted backup', function () {
    const workflow = readPagesWorkflow();
    const unitIndex = workflow.indexOf('run: npm test');
    const authE2eIndex = workflow.indexOf('run: npm run test:auth-e2e');
    const dryRunIndex = workflow.indexOf('--dry-run');
    const backupIndex = workflow.indexOf('backup-kv-state.mjs --environment production');
    const artifactIndex = workflow.indexOf('actions/upload-artifact@v4');
    const coordinatorIndex = workflow.lastIndexOf('wrangler deploy --config workers/coordinator/wrangler.jsonc');

    for (const gate of [unitIndex, authE2eIndex, dryRunIndex, backupIndex, artifactIndex]) {
      assert.ok(gate >= 0 && gate < coordinatorIndex, 'every verification and backup gate must precede deploy');
    }
    assert.match(workflow, /BACKUP_ENCRYPTION_KEY:\s*\$\{\{ secrets\.BACKUP_ENCRYPTION_KEY \}\}/);
  });
});
