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
});
