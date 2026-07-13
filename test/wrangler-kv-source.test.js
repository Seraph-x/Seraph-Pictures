const assert = require('node:assert');

describe('Wrangler OAuth KV source', function () {
  it('lists metadata and preserves binary values without exposing OAuth tokens', async function () {
    const { createWranglerKvSource } = await import('../scripts/security/wrangler-kv-source.mjs');
    const calls = [];
    const source = createWranglerKvSource({
      namespaceId: 'namespace-id',
      runCommand: async (args) => {
        calls.push(args);
        if (args[2] === 'list') {
          return Buffer.from(JSON.stringify([{ name: 'binary-key', metadata: { type: 'file' } }]));
        }
        return Buffer.from([0, 255, 1]);
      },
    });

    assert.deepStrictEqual(await source.listPage(null), {
      keys: [{ name: 'binary-key', metadata: { type: 'file' } }],
      cursor: null,
    });
    assert.strictEqual(await source.readValue('binary-key'), Buffer.from([0, 255, 1]).toString('base64'));
    assert.deepStrictEqual(calls[1], [
      'kv', 'key', 'get', 'binary-key', '--remote', '--namespace-id', 'namespace-id',
    ]);
  });
});
