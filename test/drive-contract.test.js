const assert = require('node:assert');

const EXPECTED_OPERATIONS = Object.freeze({
  tree: ['GET', '/api/drive/tree', 'nodes'],
  explorer: ['GET', '/api/drive/explorer', 'explorer'],
  createFolder: ['POST', '/api/drive/folders', 'folder'],
  moveFolder: ['POST', '/api/drive/folders/move', 'mutation'],
  deleteFolder: ['DELETE', '/api/drive/folders', 'mutation'],
  moveFiles: ['POST', '/api/drive/files/move', 'mutation'],
  renameFile: ['POST', '/api/drive/files/rename', 'file'],
  deleteFiles: ['POST', '/api/drive/files/delete-batch', 'mutation'],
  signShare: ['POST', '/api/share/sign', 'share'],
});

describe('shared Drive API contract', function () {
  it('describes every frontend Drive and share operation', function () {
    const { driveOperation } = require('../shared/storage/contracts.cjs');
    for (const [name, expected] of Object.entries(EXPECTED_OPERATIONS)) {
      const operation = driveOperation(name);
      assert.deepStrictEqual(
        [operation.method, operation.path, operation.envelope], expected, name,
      );
      assert.strictEqual(operation.auth, 'admin', name);
      assert.ok(Object.isFrozen(operation), name);
    }
  });

  it('normalizes canonical paths and rejects traversal', function () {
    const { normalizeDrivePath } = require('../shared/storage/contracts.cjs');
    assert.strictEqual(normalizeDrivePath(' /photos//2026/ '), 'photos/2026');
    assert.strictEqual(normalizeDrivePath(''), '');
    assert.throws(() => normalizeDrivePath('photos/../private'), /DRIVE_PATH_INVALID/);
    assert.throws(() => normalizeDrivePath('photos/\0bad'), /DRIVE_PATH_INVALID/);
  });

  it('normalizes folders and files with explicit visibility', function () {
    const contract = require('../shared/storage/contracts.cjs');
    assert.deepStrictEqual(contract.normalizeDriveFolder({ path: 'photos/2026' }), {
      path: 'photos/2026', name: '2026', parentPath: 'photos',
    });
    const file = contract.normalizeDriveFile({
      name: 'r2:file.jpg',
      metadata: {
        fileName: 'file.jpg', fileSize: 12, mimeType: 'image/jpeg',
        storageType: 'r2', folderPath: 'photos', visibility: 'private',
        TimeStamp: 100,
      },
    });
    assert.deepStrictEqual(file, {
      id: 'r2:file.jpg', fileName: 'file.jpg', fileSize: 12,
      mimeType: 'image/jpeg', storageType: 'r2', folderPath: 'photos',
      visibility: 'private', createdAt: 100,
    });
    assert.throws(
      () => contract.normalizeDriveFile({ id: 'one', fileName: 'one.jpg', visibility: 'hidden' }),
      /FILE_VISIBILITY_INVALID/,
    );
  });

  it('normalizes opaque cursor pagination and explorer envelopes', function () {
    const pagination = require('../shared/storage/pagination.cjs');
    const contract = require('../shared/storage/contracts.cjs');
    assert.deepStrictEqual(pagination.normalizePageRequest({ limit: '25', cursor: ' opaque ' }), {
      limit: 25, cursor: 'opaque',
    });
    assert.deepStrictEqual(contract.driveEnvelope('explorer', {
      folders: [{ path: 'photos' }],
      files: [{ id: 'one', fileName: 'one.jpg', visibility: 'public' }],
      nextCursor: 'next-token', stats: { files: 1 },
    }), {
      success: true,
      folders: [{ path: 'photos', name: 'photos', parentPath: '' }],
      files: [{
        id: 'one', fileName: 'one.jpg', fileSize: 0, mimeType: '',
        storageType: '', folderPath: '', visibility: 'public', createdAt: null,
      }],
      nextCursor: 'next-token', stats: { files: 1 },
    });
    assert.throws(
      () => pagination.normalizePageRequest({ limit: 1001 }), /PAGE_LIMIT_INVALID/,
    );
  });

  it('rejects unsupported operations and invalid cursors explicitly', function () {
    const { driveOperation } = require('../shared/storage/contracts.cjs');
    const { normalizePageRequest } = require('../shared/storage/pagination.cjs');
    assert.throws(() => driveOperation('copyFolder'), /API_OPERATION_UNSUPPORTED/);
    assert.throws(() => normalizePageRequest({ cursor: '\0' }), /PAGE_CURSOR_INVALID/);
  });
});
