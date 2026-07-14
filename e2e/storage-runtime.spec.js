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

async function initialize(request, fileName, storageId) {
  const bytes = Buffer.alloc(PART_SIZE, fileName.charCodeAt(0));
  const body = await expectJson(await request.post(`${PAGES_URL}/api/chunked-upload/init`, {
    data: {
      fileName, fileType: 'image/png', fileSize: bytes.length,
      totalChunks: 1, rootDigest: digest(bytes), storageMode: 'r2', storageId,
      visibility: 'private',
    },
  }));
  return Object.freeze({ bytes, uploadId: body.uploadId });
}

async function createPagesR2(request, name = 'E2E R2') {
  const body = await expectJson(await request.post(`${PAGES_URL}/api/storage`, {
    headers: APP_HEADERS,
    data: {
      name, type: 'r2',
      config: { adapterMode: 'binding', bindingName: 'R2_BUCKET' },
    },
  }));
  return body.item.id;
}

async function uploadPagesFile(request, fileName, storageId) {
  const upload = await initialize(request, fileName, storageId);
  await expectJson(await request.post(`${PAGES_URL}/api/chunked-upload/chunk`, {
    multipart: partForm(upload),
  }));
  return expectJson(await request.post(`${PAGES_URL}/api/chunked-upload/complete`, {
    data: { uploadId: upload.uploadId },
  }));
}

async function uploadPagesDriveFile(request, fileName, storageId) {
  return expectJson(await request.post(`${PAGES_URL}/upload`, {
    headers: APP_HEADERS,
    multipart: {
      file: { name: fileName, mimeType: 'image/png', buffer: Buffer.from(fileName) },
      storageMode: 'r2', storageId, folderPath: '',
    },
  }));
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

async function createTelegramProfile(request, name) {
  const body = await expectJson(await request.post(`${PAGES_URL}/api/storage`, {
    headers: APP_HEADERS,
    data: { name, type: 'telegram', config: { botToken: `${name}-token`, chatId: `${name}-chat` } },
  }));
  return body.item;
}

test('real Pages R2 multipart persists retries, conflicts, completion, and cancellation', async ({ request }) => {
  const storageConfigId = await createPagesR2(request);
  const upload = await initialize(request, 'success.png', storageConfigId);
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

  const cancelled = await initialize(request, 'cancel.png', storageConfigId);
  const cancel = await expectJson(await request.delete(`${PAGES_URL}/api/chunked-upload/cancel`, {
    data: { uploadId: cancelled.uploadId },
  }));
  expect(cancel.phase).toBe('aborted');
});

test('Vue upload queue snapshots and sends the exact storage profile', async ({ page, request }) => {
  const primary = await createTelegramProfile(request, 'Upload Primary');
  const archive = await createTelegramProfile(request, 'Upload Archive');
  let directBody = '';
  let urlBody = null;
  await page.route('**/api/status', (route) => route.fulfill({ json: {} }));
  await page.route(/\/upload$/, async (route) => {
    directBody = route.request().postData() || '';
    await route.fulfill({ json: { src: '/file/direct-test' } });
  });
  await page.route('**/api/upload-from-url', async (route) => {
    urlBody = route.request().postDataJSON();
    await route.fulfill({ json: { src: '/file/url-test' } });
  });
  await page.goto(`${PAGES_URL}/app/`);
  const selector = page.getByTestId('upload-storage-profile');
  await expect(selector.locator(`option[value="${primary.id}"]`)).toHaveCount(1);
  await expect(selector.locator(`option[value="${archive.id}"]`)).toHaveCount(1);
  await selector.selectOption(archive.id);
  await page.locator('input[type="file"]').setInputFiles({
    name: 'exact.txt', mimeType: 'text/plain', buffer: Buffer.from('exact-profile'),
  });
  await selector.selectOption(primary.id);
  await expect(page.getByText('Telegram · Upload Archive · 根目录 /')).toBeVisible();
  await expect.poll(() => directBody).toContain(archive.id);

  await page.locator('.url-row input').fill('https://example.test/image.png');
  await page.getByRole('button', { name: '上传 URL' }).click();
  await expect.poll(() => urlBody?.storageId).toBe(primary.id);
  expect(urlBody.storageMode).toBe('telegram');

  await selector.selectOption(archive.id);
  await expectJson(await request.put(`${PAGES_URL}/api/storage/${archive.id}`, {
    headers: APP_HEADERS, data: { enabled: false },
  }));
  await page.reload();
  await expect(selector.locator(`option[value="${archive.id}"]`)).toHaveCount(0);
  await expect(selector.locator(`option[value="${primary.id}"]`)).toHaveCount(1);
  await expect(page.locator('.storage-profile-notice')).toBeVisible();
});

test('Drive filters, labels, uploads, migrates, and reports exact profiles', async ({ page, request }) => {
  const sourceId = await createPagesR2(request, 'Drive Source');
  const destinationId = await createPagesR2(request, 'Drive Archive');
  await uploadPagesDriveFile(request, 'source-drive.png', sourceId);
  await uploadPagesDriveFile(request, 'archive-drive.png', destinationId);
  await expectJson(await request.post(`${PAGES_URL}/api/storage/default/${destinationId}`, {
    headers: APP_HEADERS,
  }));
  await expectJson(await request.put(`${PAGES_URL}/api/storage/${sourceId}`, {
    headers: APP_HEADERS, data: { enabled: false },
  }));
  const exactSource = await expectJson(await request.get(
    `${PAGES_URL}/api/drive/explorer?storageId=${sourceId}&includeStats=1`,
  ));
  expect(exactSource.files.map((file) => file.metadata.fileName)).toContain('source-drive.png');

  await page.goto(`${PAGES_URL}/app/drive/`);
  const filter = page.getByTestId('drive-storage-profile');
  await expect(filter.locator(`option[value="${sourceId}"]`)).toContainText('Drive Source');
  await filter.selectOption(sourceId);
  await expect(page.locator('tbody').getByText('R2 · Drive Source', { exact: true })).toBeVisible();
  await expect(page.getByText('archive-drive.png')).toHaveCount(0);

  const destination = page.getByTestId('drive-migration-destination');
  await page.locator('tbody input[type="checkbox"]').first().check();
  await expect(destination.locator(`option[value="${sourceId}"]`)).toHaveCount(0);
  await expect(destination.locator(`option[value="${destinationId}"]`)).toHaveCount(1);
  await destination.selectOption(destinationId);
  await page.getByTestId('drive-migrate').click();
  await expect(page.getByText('source-drive.png')).toHaveCount(0);
  const migratedDestination = await expectJson(await request.get(
    `${PAGES_URL}/api/drive/explorer?storageId=${destinationId}&includeStats=1`,
  ));
  const migrated = migratedDestination.files.find(
    (file) => file.metadata.fileName === 'source-drive.png',
  );
  expect(migrated.metadata.storageId).toBe(destinationId);

  await page.locator('.adapter-card').filter({ hasText: /^R2/ }).click();
  const uploadProfile = page.getByTestId('upload-storage-profile');
  await expect(uploadProfile.locator(`option[value="${destinationId}"]`)).toHaveCount(1);
  await uploadProfile.selectOption(destinationId);
  await page.locator('.drive-dropzone input[type="file"]').setInputFiles({
    name: 'drive-exact.txt', mimeType: 'text/plain', buffer: Buffer.from('drive-exact-profile'),
  });
  await expect(page.locator('.queue-target').getByText('R2 · Drive Archive', { exact: false })).toBeVisible();
  await expect(page.getByText('成功')).toBeVisible();
  const exactDestination = await expectJson(await request.get(
    `${PAGES_URL}/api/drive/explorer?storageId=${destinationId}&includeStats=1`,
  ));
  const uploaded = exactDestination.files.find((file) => file.metadata.fileName === 'drive-exact.txt');
  expect(uploaded.metadata).toMatchObject({
    storageId: destinationId, visibility: 'private',
    uploadSource: 'drive', accessVersion: 1,
  });

  await createTelegramProfile(request, 'Status Telegram One');
  await createTelegramProfile(request, 'Status Telegram Two');
  await page.goto(`${PAGES_URL}/app/status/`);
  const statusGrid = page.locator('.storage-profile-status-grid');
  await expect(statusGrid.getByText('Status Telegram One')).toBeVisible({ timeout: 15_000 });
  await expect(statusGrid.getByText('Status Telegram Two')).toBeVisible();
});

test('Legacy upload and admin preserve exact profile identities', async ({ page, request }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  const sourceId = await createPagesR2(request, 'Legacy Source');
  const destinationId = await createPagesR2(request, 'Legacy Archive');
  await uploadPagesDriveFile(request, 'legacy-source.png', sourceId);
  let directBody = '';
  let urlBody = null;
  let multipartBody = null;
  await page.route(/\/upload$/, async (route) => {
    directBody = route.request().postData() || '';
    await route.fulfill({ json: [{ src: '/file/legacy-direct' }] });
  });
  await page.route('**/api/upload-from-url', async (route) => {
    urlBody = route.request().postDataJSON();
    await route.fulfill({ json: [{ src: '/file/legacy-url' }] });
  });
  await page.route('**/api/chunked-upload/init', async (route) => {
    multipartBody = route.request().postDataJSON();
    await route.fulfill({ json: { uploadId: 'legacy-multipart' } });
  });
  await page.route('**/api/chunked-upload/chunk', (route) => route.fulfill({ json: { success: true } }));
  await page.route('**/api/chunked-upload/complete', (route) => route.fulfill({ json: { src: '/file/legacy-multipart' } }));

  await page.goto(`${PAGES_URL}/`);
  await page.getByRole('button', { name: 'R2 存储' }).click();
  const uploadProfile = page.locator('[data-storage-profile-select]');
  await uploadProfile.selectOption(destinationId);
  await page.locator('input[type="file"]').setInputFiles({
    name: 'legacy-exact.txt', mimeType: 'text/plain', buffer: Buffer.from('legacy-exact'),
  });
  await expect.poll(() => directBody).toContain(destinationId);
  await page.evaluate(() => {
    document.querySelector('#app').__vue__.uploadConfig.smallFileThreshold = 1;
    document.querySelector('#app').__vue__.uploadLimits.r2.directThreshold = 1;
  });
  await page.locator('input[type="file"]').setInputFiles({
    name: 'legacy-multipart.txt', mimeType: 'text/plain', buffer: Buffer.from('multipart'),
  });
  await expect.poll(() => multipartBody?.storageId).toBe(destinationId);
  await page.getByRole('button', { name: 'URL上传' }).click();
  await page.locator('.url-input-container input').fill('https://example.test/legacy.png');
  await page.locator('.url-input-container button').click();
  await expect.poll(() => urlBody?.storageId).toBe(destinationId);

  const explorerRequests = [];
  page.on('request', (event) => {
    if (event.url().includes('/api/drive/explorer')) explorerRequests.push(event.url());
  });
  await page.goto(`${PAGES_URL}/admin`);
  const filter = page.locator('[data-storage-profile-filter]');
  await filter.selectOption(sourceId);
  await expect.poll(() => explorerRequests.some((url) => url.includes(`storageId=${sourceId}`))).toBe(true);
  await page.evaluate(() => { document.querySelector('#app').__vue__.viewMode = 'list'; });
  const sourceLabels = page.locator('.el-table__body .cell').filter({ hasText: 'r2 · Legacy Source' });
  await expect(sourceLabels.first()).toBeVisible();
  await page.locator('.el-table__body .el-checkbox').first().click();
  const destination = page.locator('[data-migration-storage-profile]');
  await expect(destination.locator(`option[value="${sourceId}"]`)).toHaveCount(0);
  await destination.selectOption(destinationId);
  await page.getByRole('button', { name: 'Migrate' }).click();
  await expect(page.getByText('legacy-source.png')).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

test('Pages and Docker expose matching Storage and Drive contracts', async ({ request }) => {
  const pagesStorage = await exerciseStorage(request, PAGES_URL);
  const dockerStorage = await exerciseStorage(request, DOCKER_URL);
  expect(typeof pagesStorage).toBe('string');
  expect(typeof dockerStorage).toBe('string');
  await exerciseDrive(request, PAGES_URL, 'pages');
  await exerciseDrive(request, DOCKER_URL, 'docker');
});
