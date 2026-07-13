const assert = require('assert');

const {
  STATUS_ACTORS,
  decideStatusAccess,
} = require('../shared/security/status-policy.cjs');

describe('shared status boundary policy', () => {
  it('returns only a minimal immutable body to anonymous callers', () => {
    const decision = decideStatusAccess({ actor: STATUS_ACTORS.ANONYMOUS });

    assert.deepStrictEqual(decision, {
      runProbes: false,
      body: { status: 'ok' },
    });
    assert.strictEqual(Object.isFrozen(decision), true);
    assert.strictEqual(Object.isFrozen(decision.body), true);
  });

  it('allows authenticated administrators to run bounded probes', () => {
    assert.deepStrictEqual(
      decideStatusAccess({ actor: STATUS_ACTORS.ADMIN }),
      { runProbes: true, body: null },
    );
  });

  it('treats unknown actors as anonymous', () => {
    assert.deepStrictEqual(
      decideStatusAccess({ actor: 'unexpected' }),
      { runProbes: false, body: { status: 'ok' } },
    );
  });
});
