const assert = require('node:assert');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const MODULE_URL = pathToFileURL(
  path.resolve(__dirname, '../scripts/security/backup-lib.mjs')
).href;
const SOURCE_URL = pathToFileURL(
  path.resolve(__dirname, '../scripts/security/cloudflare-kv-source.mjs')
).href;
const CLI_URL = pathToFileURL(
  path.resolve(__dirname, '../scripts/security/backup-kv-state.mjs')
).href;

function createSource(records) {
  const pages = [records.slice(0, 3), records.slice(3)];
  return {
    async listPage(cursor) {
      const index = cursor ? Number(cursor) : 0;
      return {
        keys: pages[index].map(({ name, metadata }) => ({ name, metadata })),
        cursor: index + 1 < pages.length ? String(index + 1) : null,
      };
    },
    async readValue(name) {
      return records.find((record) => record.name === name).valueBase64;
    },
  };
}

describe('encrypted KV recovery backup', function () {
  it('paginates and preserves credentials, config, sessions, schema, and file metadata', async function () {
    const { collectRecords } = await import(MODULE_URL);
    const input = [
      { name: 'admin_credentials', valueBase64: 'Y3JlZGVudGlhbC1zZWNyZXQ=', metadata: null },
      { name: 'storage_config', valueBase64: 'c3RvcmFnZS1zZWNyZXQ=', metadata: null },
      { name: 'guest_config', valueBase64: 'Z3Vlc3Qtc2VjcmV0', metadata: null },
      { name: 'security:schema_version', valueBase64: 'MQ==', metadata: null },
      { name: 'session:abc', valueBase64: 'c2Vzc2lvbi1zZWNyZXQ=', metadata: null },
      { name: 'r2:public/image.jpg', valueBase64: '', metadata: { fileName: 'image.jpg' } },
    ];

    const records = await collectRecords(createSource(input));

    assert.deepStrictEqual(records, input);
  });

  it('encrypts records and verifies authenticated read-back', async function () {
    const { encryptRecords, decryptRecords } = await import(MODULE_URL);
    const records = [{ name: 'admin_credentials', valueBase64: 'bm90LWZvci1zdGRvdXQ=', metadata: null }];
    const envelope = await encryptRecords({ records, passphrase: 'backup-passphrase' });

    assert.strictEqual(envelope.schemaVersion, 1);
    assert.ok(!JSON.stringify(envelope).includes('not-for-stdout'));
    assert.deepStrictEqual(await decryptRecords({ envelope, passphrase: 'backup-passphrase' }), records);
    await assert.rejects(
      decryptRecords({ envelope, passphrase: 'wrong-passphrase' }),
      /BACKUP_DECRYPT_FAILED/
    );
  });

  it('summarizes counts without key names or values', async function () {
    const { summarizeRecords } = await import(MODULE_URL);
    const records = [{ name: 'admin_credentials', valueBase64: 'c2VjcmV0LXZhbHVl', metadata: null }];
    const summary = JSON.stringify(summarizeRecords(records));

    assert.match(summary, /"total":1/);
    assert.ok(!summary.includes('admin_credentials'));
    assert.ok(!summary.includes('secret-value'));
  });

  it('reads Cloudflare pages and binary values through the documented API', async function () {
    const { createCloudflareKvSource } = await import(SOURCE_URL);
    const requests = [];
    const fetchImpl = async (url) => {
      requests.push(url);
      if (url.includes('/keys')) {
        return new Response(JSON.stringify({
          success: true,
          result: [{ name: 'admin_credentials', metadata: null }],
          result_info: { cursor: '' },
        }), { status: 200 });
      }
      return new Response(Uint8Array.from([0, 255, 1]), { status: 200 });
    };
    const source = createCloudflareKvSource({
      accountId: 'account', namespaceId: 'namespace', apiToken: 'token', fetchImpl,
    });

    assert.deepStrictEqual((await source.listPage(null)).keys, [
      { name: 'admin_credentials', metadata: null },
    ]);
    assert.strictEqual(await source.readValue('admin_credentials'), 'AP8B');
    assert.strictEqual(requests.length, 2);
  });

  it('rejects repository-local backup output and requires production inputs', async function () {
    const { validateOptions } = await import(CLI_URL);
    const repoRoot = path.resolve(__dirname, '..');

    assert.throws(() => validateOptions({ environment: 'production', output: repoRoot }), /OUTPUT_OUTSIDE_REPOSITORY_REQUIRED/);
    assert.throws(() => validateOptions({ environment: 'preview', output: '/tmp/backup.json' }), /PRODUCTION_ENVIRONMENT_REQUIRED/);
    assert.throws(() => validateOptions({ environment: 'production', output: '/tmp/backup.json' }), /BACKUP_ENCRYPTION_KEY_REQUIRED/);
  });
});
