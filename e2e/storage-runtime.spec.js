const { createHash } = require('node:crypto');
const { test, expect } = require('@playwright/test');

const PAGES_URL = 'http://127.0.0.1:4184';
const DOCKER_URL = 'http://127.0.0.1:4185';
const PART_SIZE = 5 * 1024 * 1024;
const APP_HEADERS = Object.freeze({
  Accept: 'application/vnd.seraph.v2+json',
  'X-Seraph-Client': 'app-v2',
});

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function expectJson(response, status = 200) {
  const body = await response.json();
  expect(response.status(), JSON.stringify(body)).toBe(status);
  return body;
}

async function initialize(request, fileName) {
  const bytes = Buffer.alloc(PART_SIZE, fileName.charCodeAt(0));
  const body = await expectJson(await request.post(`${PAGES_URL}/api/chunked-upload/init`, {
    data: {
      fileName, fileType: 'image/png', fileSize: bytes.length,
      totalChunks: 1, rootDigest: digest(bytes), storageMode: 'r2', visibility: 'private',
    },
  }));
  return Object.freeze({ bytes, uploadId: body.uploadId });
}

function partForm(upload, bytes = upload.bytes) {
  return {
    uploadId: upload.uploadId,
    chunkIndex: '0',
    digest: digest(bytes),
    chunk: { name: 'part.bin', mimeType: 'application/octet-stream', buffer: bytes },
  };
}

async function exerciseStorage(request, baseURL) {
  const created = await expectJson(await request.post(`${baseURL}/api/storage`, {
    headers: APP_HEADERS,
    data: { name: 'E2E Telegram', type: 'telegram', config: { botToken: 'secret', chatId: 'chat' } },
  }));
  expect(created.item.config.botToken).toBe('********');
  const updated = await expectJson(await request.put(`${baseURL}/api/storage/${created.item.id}`, {
    headers: APP_HEADERS,
    data: { name: 'E2E Telegram', config: { botToken: '', chatId: 'updated' } },
  }));
  expect(updated.item.config).toMatchObject({ botToken: '********', chatId: 'updated' });
  return created.item.id;
}

async function exerciseDrive(request, baseURL, suffix) {
  const source = `e2e-${suffix}`;
  const target = `${source}-moved`;
  const created = await expectJson(await request.post(`${baseURL}/api/drive/folders`, {
    headers: APP_HEADERS, data: { path: source },
  }));
  expect(created.folder.path).toBe(source);
  const moved = await expectJson(await request.post(`${baseURL}/api/drive/folders/move`, {
    headers: APP_HEADERS, data: { sourcePath: source, targetPath: target },
  }));
  expect(moved.targetPath).toBe(target);
  await expectJson(await request.delete(`${baseURL}/api/drive/folders?path=${target}`, {
    headers: APP_HEADERS,
  }));
}

test('real Pages R2 multipart persists retries, conflicts, completion, and cancellation', async ({ request }) => {
  const upload = await initialize(request, 'success.png');
  const first = await request.post(`${PAGES_URL}/api/chunked-upload/chunk`, { multipart: partForm(upload) });
  await expectJson(first);
  await expectJson(await request.post(`${PAGES_URL}/api/chunked-upload/chunk`, {
    multipart: partForm(upload),
  }));

  const different = Buffer.alloc(PART_SIZE, 9);
  const conflict = await request.post(`${PAGES_URL}/api/chunked-upload/chunk`, {
    multipart: partForm(upload, different),
  });
  expect((await expectJson(conflict, 409)).code).toBe('MULTIPART_PART_CONFLICT');

  const completed = await expectJson(await request.post(`${PAGES_URL}/api/chunked-upload/complete`, {
    data: { uploadId: upload.uploadId },
  }));
  expect(completed.src).toBe(`/file/r2:${upload.uploadId}`);
  await expectJson(await request.post(`${PAGES_URL}/api/chunked-upload/complete`, {
    data: { uploadId: upload.uploadId },
  }));

  const cancelled = await initialize(request, 'cancel.png');
  const cancel = await expectJson(await request.delete(`${PAGES_URL}/api/chunked-upload/cancel`, {
    data: { uploadId: cancelled.uploadId },
  }));
  expect(cancel.phase).toBe('aborted');
});

test('Pages and Docker expose matching Storage and Drive contracts', async ({ request }) => {
  const pagesStorage = await exerciseStorage(request, PAGES_URL);
  const dockerStorage = await exerciseStorage(request, DOCKER_URL);
  expect(typeof pagesStorage).toBe('string');
  expect(typeof dockerStorage).toBe('string');
  await exerciseDrive(request, PAGES_URL, 'pages');
  await exerciseDrive(request, DOCKER_URL, 'docker');
});
