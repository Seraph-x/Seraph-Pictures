const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const MIN_SHARE_SECRET_CHARACTERS = 32;

function readWorkflow() {
  return fs.readFileSync(
    path.join(ROOT, '.github/workflows/docker-smoke.yml'),
    'utf8',
  );
}

function readSmokeScript() {
  return fs.readFileSync(path.join(ROOT, 'scripts/docker-ci-smoke.js'), 'utf8');
}

describe('Docker smoke workflow', function () {
  it('provides a valid CI-only current file share secret', function () {
    const workflow = readWorkflow();
    const match = workflow.match(/^\s*FILE_SHARE_SECRET_CURRENT=(\S+)\s*$/m);

    assert.ok(match, 'Docker smoke env must define FILE_SHARE_SECRET_CURRENT');
    assert.ok(match[1].length >= MIN_SHARE_SECRET_CHARACTERS);
    assert.doesNotMatch(match[1], /^(replace_with|change_this|your[_-]?secret|placeholder)/i);
  });

  it('authenticates the detailed status request with the configured administrator', function () {
    const script = readSmokeScript();

    assert.match(script, /process\.env\.BASIC_USER/);
    assert.match(script, /process\.env\.BASIC_PASS/);
    assert.match(script, /Authorization:\s*`Basic \$\{authorization\}`/);
    assert.doesNotMatch(script, /wget[^\n]+\/api\/status/);
  });
});
