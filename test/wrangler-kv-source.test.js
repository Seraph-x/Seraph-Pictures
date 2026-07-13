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

  it('uses a remote bulk write without putting values on the command line', async function () {
    const { createWranglerKvSource } = await import('../scripts/security/wrangler-kv-source.mjs');
    const calls = [];
    const source = createWranglerKvSource({
      namespaceId: 'namespace-id',
      runCommand: async (args) => { calls.push(args); return Buffer.alloc(0); },
    });

    await source.writeRecords([{
      name: 'file.png', valueBase64: 'c2VjcmV0', metadata: { fileName: 'file.png' },
    }]);

    assert.deepStrictEqual(calls[0].slice(0, 3), ['kv', 'bulk', 'put']);
    assert.ok(calls[0].includes('--remote'));
    assert.ok(!calls[0].join(' ').includes('c2VjcmV0'));
  });

  it('converts command failures into an error that contains no key name', async function () {
    const { createWranglerKvSource } = await import('../scripts/security/wrangler-kv-source.mjs');
    const source = createWranglerKvSource({
      namespaceId: 'namespace-id', wranglerBin: '/definitely/missing-wrangler',
    });

    await assert.rejects(
      source.readValue('private/path/secret.png'),
      (error) => error.message === 'WRANGLER_KV_COMMAND_FAILED'
        && !error.message.includes('private/path/secret.png'),
    );
  });
});
