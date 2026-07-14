const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

describe('Auth E2E isolated Pages runtime', function () {
  it('copies every repository-local module root imported by Pages Functions', function () {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../e2e/start-auth-runtime.mjs'), 'utf8',
    );
    const assets = source.match(/const UNBOUND_ASSETS = \[([\s\S]*?)\];/)?.[1] || '';
    assert.match(assets, /['"]functions['"]/);
    assert.match(assets, /['"]shared['"]/);
  });
});
