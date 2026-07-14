const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

describe('multi-profile storage regression scripts', function () {
  it('requires two same-type profiles and verifies the per-type default', function () {
    const regression = read('scripts/storage-regression.js');
    const smoke = read('scripts/docker-ci-smoke.js');
    for (const source of [regression, smoke]) {
      assert.match(source, /createSameTypeProfiles/);
      assert.match(source, /verifyPerTypeDefault/);
      assert.match(source, /firstProfile/);
      assert.match(source, /secondProfile/);
    }
  });

  it('sends an exact upload target and proves disabled historical reads', function () {
    const regression = read('scripts/storage-regression.js');
    const smoke = read('scripts/docker-ci-smoke.js');
    assert.match(regression, /body\.append\('storageMode',\s*profile\.type\)/);
    assert.match(regression, /body\.append\('storageId',\s*profile\.id\)/);
    for (const source of [regression, smoke]) {
      assert.match(source, /verifyDisabledHistoricalRead/);
      assert.match(source, /STORAGE_CONFIG_DISABLED/);
    }
  });

  it('checks guest isolation and exact profile status records', function () {
    const regression = read('scripts/storage-regression.js');
    const smoke = read('scripts/docker-ci-smoke.js');
    for (const source of [regression, smoke]) {
      assert.match(source, /verifyGuestIsolation/);
      assert.match(source, /storageProfiles/);
      assert.match(source, /storageId/);
      assert.doesNotMatch(source, /response\.json\(\)\.catch\(\(\) => \(\{\}\)\)/);
      assert.doesNotMatch(source, /best effort/i);
    }
  });

  it('runs the multi-profile smoke gate in Docker CI', function () {
    const workflow = read('.github/workflows/docker-smoke.yml');
    assert.match(workflow, /Run multi-profile storage smoke/);
    assert.match(workflow, /npm run docker:smoke:ci/);
    assert.match(workflow, /MULTI_PROFILE_SMOKE_TYPE=telegram/);
  });
});
