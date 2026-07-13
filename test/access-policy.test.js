const assert = require('assert');

const {
  ACCESS_ACTORS,
  FILE_VISIBILITY,
  decideFileAccess,
} = require('../shared/security/access-policy.cjs');

const NOW_SECONDS = 1_800_000_000;

function decide(overrides = {}) {
  return decideFileAccess({
    visibility: FILE_VISIBILITY.PRIVATE,
    actor: ACCESS_ACTORS.ANONYMOUS,
    share: null,
    accessVersion: 3,
    nowSeconds: NOW_SECONDS,
    ...overrides,
  });
}

describe('shared file access policy', () => {
  it('conceals an expired public guest file', () => {
    assert.strictEqual(decide({
      visibility: FILE_VISIBILITY.PUBLIC,
      expiresAtMs: 1_000,
      nowMs: 1_001,
    }).allowed, false);
  });

  it('allows anonymous access to explicitly public files', () => {
    assert.deepStrictEqual(decide({ visibility: FILE_VISIBILITY.PUBLIC }), {
      allowed: true,
      conceal: false,
      code: null,
    });
  });

  it('conceals private files from anonymous callers', () => {
    assert.deepStrictEqual(decide(), {
      allowed: false,
      conceal: true,
      code: 'FILE_ACCESS_DENIED',
    });
  });

  it('allows administrators to access private files', () => {
    assert.deepStrictEqual(decide({ actor: ACCESS_ACTORS.ADMIN }), {
      allowed: true,
      conceal: false,
      code: null,
    });
  });

  it('allows a current, unrevoked share for the current access version', () => {
    const share = Object.freeze({
      expiresAt: NOW_SECONDS + 60,
      accessVersion: 3,
      revoked: false,
    });

    assert.deepStrictEqual(decide({ share }), {
      allowed: true,
      conceal: false,
      code: null,
    });
  });

  it('conceals expired, revoked, and version-stale shares', () => {
    const rejectedShares = [
      { expiresAt: NOW_SECONDS, accessVersion: 3, revoked: false },
      { expiresAt: NOW_SECONDS + 60, accessVersion: 3, revoked: true },
      { expiresAt: NOW_SECONDS + 60, accessVersion: 2, revoked: false },
    ];

    for (const share of rejectedShares) {
      assert.deepStrictEqual(decide({ share }), {
        allowed: false,
        conceal: true,
        code: 'FILE_ACCESS_DENIED',
      });
    }
  });

  it('fails closed when migrated metadata has no explicit visibility', () => {
    assert.deepStrictEqual(decide({ visibility: undefined }), {
      allowed: false,
      conceal: true,
      code: 'FILE_ACCESS_DENIED',
    });
  });

  it('does not mutate or return mutable policy results', () => {
    const options = Object.freeze({
      visibility: FILE_VISIBILITY.PUBLIC,
      actor: ACCESS_ACTORS.ANONYMOUS,
      share: null,
      accessVersion: 1,
      nowSeconds: NOW_SECONDS,
    });
    const result = decideFileAccess(options);

    assert.strictEqual(Object.isFrozen(result), true);
    assert.strictEqual(options.visibility, FILE_VISIBILITY.PUBLIC);
  });
});
