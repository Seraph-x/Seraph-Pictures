const assert = require('node:assert');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const libraryUrl = pathToFileURL(
  path.resolve(__dirname, '../scripts/security/visibility-migration-lib.mjs'),
).href;
const cliUrl = pathToFileURL(
  path.resolve(__dirname, '../scripts/security/migrate-visibility.mjs'),
).href;

function fixtureSource(initialRecords, options = {}) {
  let records = initialRecords.map((record) => structuredClone(record));
  const writes = [];
  return {
    writes,
    async listPage(cursor) {
      if (cursor) return { keys: [], cursor: null };
      return { keys: records.map(({ name, metadata, expiration }) => (
        { name, metadata, expiration }
      )), cursor: null };
    },
    async readValue(name) {
      return records.find((record) => record.name === name).valueBase64;
    },
    async writeRecords(next) {
      writes.push(next.map((record) => structuredClone(record)));
      if (options.ignoreWrites) return;
      records = records.map((record) => {
        const replacement = next.find((item) => item.name === record.name);
        if (!replacement) return record;
        const applied = { ...record, ...replacement };
        return options.corruptValue ? { ...applied, valueBase64: 'Y29ycnVwdA==' } : applied;
      });
    },
    async writeMarker(marker) {
      writes.push([structuredClone(marker)]);
      if (options.ignoreMarker) return;
      records.push(structuredClone(marker));
    },
  };
}

function legacy(name = 'legacy.png') {
  return {
    name,
    valueBase64: Buffer.from('original').toString('base64'),
    expiration: 2_000_000_000,
    metadata: { fileName: name, fileSize: 8, TimeStamp: 1, liked: false },
  };
}

function freezeProof() {
  return Object.freeze({
    frozen: true, active: 0, generation: 'generation-1', audience: 'namespace',
  });
}

describe('visibility metadata migration', function () {
  it('dry-runs without writing and reports legacy plus migrated records', async function () {
    const { executeVisibilityMigration } = await import(libraryUrl);
    const source = fixtureSource([
      legacy(),
      { ...legacy('done.png'), metadata: {
        fileName: 'done.png', visibility: 'public', uploadSource: 'legacy', accessVersion: 1,
      } },
      { name: 'ui_config', valueBase64: 'e30=', metadata: null },
    ]);

    const result = await executeVisibilityMigration({ source, apply: false });

    assert.deepStrictEqual(result, {
      total: 3, files: 2, legacy: 1, explicit: 1, migrated: 0, markerCommitted: false,
    });
    assert.strictEqual(source.writes.length, 0);
  });

  it('preserves values, expiration, and metadata before committing the marker', async function () {
    const { executeVisibilityMigration, VISIBILITY_MARKER_KEY } = await import(libraryUrl);
    const source = fixtureSource([legacy()]);

    const result = await executeVisibilityMigration({
      source, apply: true, freezeProof: freezeProof(),
    });
    const migrated = source.writes[0][0];
    const marker = source.writes[1][0];

    assert.strictEqual(migrated.valueBase64, Buffer.from('original').toString('base64'));
    assert.strictEqual(migrated.expiration, 2_000_000_000);
    assert.deepStrictEqual(migrated.metadata, {
      fileName: 'legacy.png', fileSize: 8, TimeStamp: 1, liked: false,
      visibility: 'public', uploadSource: 'legacy', accessVersion: 1,
    });
    assert.strictEqual(marker.name, VISIBILITY_MARKER_KEY);
    assert.deepStrictEqual(
      JSON.parse(Buffer.from(marker.valueBase64, 'base64').toString('utf8')),
      {
        version: 1, complete: true, migrated: 1,
        barrierGeneration: 'generation-1', audience: 'namespace',
      },
    );
    assert.strictEqual(result.markerCommitted, true);
  });

  it('is resumable and idempotent for partially processed record sets', async function () {
    const { executeVisibilityMigration } = await import(libraryUrl);
    const source = fixtureSource([
      legacy('pending.png'),
      { ...legacy('done.png'), metadata: {
        fileName: 'done.png', visibility: 'public', uploadSource: 'legacy', accessVersion: 1,
      } },
    ]);

    await executeVisibilityMigration({ source, apply: true, freezeProof: freezeProof() });
    const firstWriteCount = source.writes.length;
    const second = await executeVisibilityMigration({
      source, apply: true, freezeProof: freezeProof(),
    });

    assert.strictEqual(source.writes.length, firstWriteCount);
    assert.strictEqual(second.legacy, 0);
    assert.strictEqual(second.markerCommitted, true);
  });

  it('rejects corrupt access metadata before any write or marker commit', async function () {
    const { executeVisibilityMigration } = await import(libraryUrl);
    const source = fixtureSource([
      legacy(),
      { ...legacy('corrupt.png'), metadata: {
        fileName: 'corrupt.png', visibility: 'hidden', uploadSource: 'legacy', accessVersion: 1,
      } },
    ]);

    await assert.rejects(
      executeVisibilityMigration({ source, apply: true, freezeProof: freezeProof() }),
      /VISIBILITY_RECORD_CORRUPT/,
    );
    assert.strictEqual(source.writes.length, 0);
  });

  it('leaves the marker unchanged when post-write verification fails', async function () {
    const { executeVisibilityMigration } = await import(libraryUrl);
    const source = fixtureSource([legacy()], { ignoreWrites: true });

    await assert.rejects(
      executeVisibilityMigration({ source, apply: true, freezeProof: freezeProof() }),
      /VISIBILITY_VERIFY_FAILED/,
    );
    assert.strictEqual(source.writes.length, 1);
  });

  it('reports a marker read-back failure instead of claiming completion', async function () {
    const { executeVisibilityMigration } = await import(libraryUrl);
    const source = fixtureSource([legacy()], { ignoreMarker: true });

    await assert.rejects(
      executeVisibilityMigration({ source, apply: true, freezeProof: freezeProof() }),
      /VISIBILITY_MARKER_VERIFY_FAILED/,
    );
    assert.strictEqual(source.writes.length, 2);
  });

  it('refuses to commit the marker when a written value fails exact read-back', async function () {
    const { executeVisibilityMigration } = await import(libraryUrl);
    const source = fixtureSource([legacy()], { corruptValue: true });

    await assert.rejects(
      executeVisibilityMigration({ source, apply: true, freezeProof: freezeProof() }),
      /VISIBILITY_VERIFY_FAILED/,
    );
    assert.strictEqual(source.writes.length, 1);
  });

  it('requires an exact explicit confirmation for production writes', async function () {
    const { validateOptions } = await import(cliUrl);
    const base = {
      environment: 'production', accountId: 'account', namespaceId: 'namespace',
      wranglerOauth: true,
    };

    assert.throws(() => validateOptions({ ...base, apply: true }), /MIGRATION_CONFIRMATION_REQUIRED/);
    assert.throws(() => validateOptions({
      ...base, apply: true, confirm: 'MIGRATE_VISIBILITY_V1',
    }), /VISIBILITY_WRITE_FREEZE_REQUIRED/);
    assert.throws(
      () => validateOptions({ ...base, apply: true, dryRun: true }),
      /MIGRATION_MODE_REQUIRED/,
    );
    assert.strictEqual(validateOptions({
      ...base, apply: true, confirm: 'MIGRATE_VISIBILITY_V1',
      freezeUrl: 'https://pictures.example',
    }).apply, true);
  });

  it('derives the write-freeze proof from a live drained coordinator status', async function () {
    const { verifyFreeze } = await import(cliUrl);
    const success = await verifyFreeze({
      rawUrl: 'https://pictures.seraphzero.com/path',
      expectedAudience: 'namespace',
      fetchImpl: async (url) => {
        assert.strictEqual(
          url.toString(), 'https://pictures.seraphzero.com/api/migration-freeze',
        );
        return Response.json(freezeProof());
      },
    });

    assert.deepStrictEqual(success, freezeProof());
    await assert.rejects(
      verifyFreeze({
        rawUrl: 'https://pictures.seraphzero.com',
        expectedAudience: 'namespace',
        fetchImpl: async () => Response.json({ ...freezeProof(), active: 1 }),
      }),
      /VISIBILITY_WRITE_FREEZE_UNVERIFIED/,
    );
    await assert.rejects(
      verifyFreeze({
        rawUrl: 'https://attacker.example',
        expectedAudience: 'namespace',
        fetchImpl: async () => Response.json(freezeProof()),
      }),
      /VISIBILITY_FREEZE_URL_INVALID/,
    );
  });

  it('rejects apply before writes unless the operator has frozen mutations', async function () {
    const { executeVisibilityMigration } = await import(libraryUrl);
    const source = fixtureSource([legacy()]);

    await assert.rejects(
      executeVisibilityMigration({ source, apply: true }),
      /VISIBILITY_WRITE_FREEZE_REQUIRED/,
    );
    assert.strictEqual(source.writes.length, 0);
  });
});
