const { createHash } = require('node:crypto');
const { test, expect } = require('@playwright/test');

const PAGES_URL = 'http://127.0.0.1:4184';
const APP_HEADERS = Object.freeze({
  Accept: 'application/vnd.seraph.v2+json',
  'X-Seraph-Client': 'app-v2',
});
const STORED_TEST_ROUTE = /\/api\/storage\/[^/]+\/test$/;
const PART_SIZE = 5 * 1024 * 1024;

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function expectJson(response, status = 200) {
  const body = await response.json();
  expect(response.status(), JSON.stringify(body)).toBe(status);
  return body;
}

async function createTelegram(request, name) {
  const response = await request.post(`${PAGES_URL}/api/storage`, {
    headers: APP_HEADERS,
    data: { name, type: 'telegram', config: { botToken: `${name}-secret`, chatId: `${name}-chat` } },
  });
  expect(response.status()).toBe(200);
  return (await response.json()).item;
}

async function listPagesStorage(request) {
  const response = await request.get(`${PAGES_URL}/api/storage/list`, { headers: APP_HEADERS });
  expect(response.status()).toBe(200);
  return (await response.json()).items;
}

async function createR2(request, name) {
  const body = await expectJson(await request.post(`${PAGES_URL}/api/storage`, {
    headers: APP_HEADERS,
    data: {
      name, type: 'r2',
      config: { adapterMode: 'binding', bindingName: 'R2_BUCKET' },
    },
  }));
  return body.item;
}

async function createReferencedR2File(request, storageId) {
  const bytes = Buffer.alloc(PART_SIZE, 7);
  const rootDigest = digest(bytes);
  const initialized = await expectJson(await request.post(`${PAGES_URL}/api/chunked-upload/init`, {
    data: {
      fileName: 'referenced.png', fileType: 'image/png', fileSize: bytes.length,
      totalChunks: 1, rootDigest, storageMode: 'r2', storageId, visibility: 'private',
    },
  }));
  await expectJson(await request.post(`${PAGES_URL}/api/chunked-upload/chunk`, {
    multipart: {
      uploadId: initialized.uploadId, chunkIndex: '0', digest: rootDigest,
      chunk: { name: 'part.bin', mimeType: 'application/octet-stream', buffer: bytes },
    },
  }));
  await expectJson(await request.post(`${PAGES_URL}/api/chunked-upload/complete`, {
    data: { uploadId: initialized.uploadId },
  }));
}

test('Vue storage settings manages same-type profiles without changing panel geometry', async ({ page, request }) => {
  await page.route(STORED_TEST_ROUTE, async (route) => {
    await route.fulfill({ json: { result: { connected: true, status: 200 } } });
  });
  await page.goto(`${PAGES_URL}/app/storage/`);

  await expect(page.locator('.storage-panel')).toBeVisible();
  await expect(page.locator('.storage-layout')).toBeVisible();
  await expect(page.getByText('新建存储')).toBeVisible();
  await expect(page.getByTestId('storage-profile-enabled')).toBeChecked();
  await expect(page.getByTestId('storage-profile-enabled')).toBeDisabled();
  await expect(page.getByTestId('storage-profile-default-checkbox')).toBeChecked();
  await expect(page.getByTestId('storage-profile-default-checkbox')).toBeDisabled();
  await page.getByLabel('名称').fill('Primary Telegram');
  await page.getByLabel('Bot Token').fill('primary-secret');
  await page.getByLabel('Chat ID').fill('primary-chat');
  await page.getByRole('button', { name: '保存配置' }).click();
  await expect(page.getByText('存储配置已创建。')).toBeVisible();
  await expect(page.getByLabel('Bot Token')).toHaveValue('********');

  const primary = (await listPagesStorage(request)).find((item) => item.name === 'Primary Telegram');
  const archive = await createTelegram(request, 'Archive Telegram');
  await page.reload();
  const selector = page.getByTestId('storage-profile-select');
  await expect(selector.locator('option')).toHaveCount(2);
  await expect(page.getByTestId('storage-profile-default-checkbox')).not.toBeChecked();
  await expect(page.getByTestId('storage-profile-default-checkbox')).toBeEnabled();
  await selector.selectOption(archive.id);
  await page.getByTestId('storage-profile-edit').click();
  await expect(page.getByLabel('Bot Token')).toHaveValue('********');
  await page.getByTestId('storage-profile-default-checkbox').check();
  await expect(page.getByTestId('storage-profile-enabled')).toBeChecked();
  await expect(page.getByTestId('storage-profile-enabled')).toBeDisabled();
  await page.getByTestId('storage-profile-default-checkbox').uncheck();
  await expect(page.getByTestId('storage-profile-enabled')).toBeEnabled();
  await page.getByLabel('Chat ID').fill('archive-updated');
  await page.getByRole('button', { name: '保存配置' }).click();
  await expect(page.getByText('存储配置已更新。')).toBeVisible();
  await page.getByTestId('storage-profile-test').click();
  await expect(page.getByText('连接成功。')).toBeVisible();
  await page.getByTestId('storage-profile-toggle').click();
  await expect(page.getByTestId('storage-profile-toggle')).toHaveText('启用');
  await expect(page.getByTestId('storage-profile-default')).toBeDisabled();
  await page.getByTestId('storage-profile-toggle').click();
  await expect(page.getByTestId('storage-profile-toggle')).toHaveText('禁用');
  await page.getByTestId('storage-profile-default').click();
  await expect(page.getByTestId('storage-profile-delete')).toBeDisabled();
  await expect(page.getByTestId('storage-profile-enabled')).toBeDisabled();
  await expect(page.getByTestId('storage-profile-default-checkbox')).toBeDisabled();
  await expect(page.getByTestId('storage-profile-default-checkbox')).toBeChecked();

  await selector.selectOption(primary.id);
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByTestId('storage-profile-delete').click();
  await expect(selector.locator('option')).toHaveCount(1);
  await page.getByRole('button', { name: '新建配置' }).click();
  await expect(page.getByText('新建存储')).toBeVisible();
  await page.getByLabel('名称').fill('Cold Telegram');
  await page.getByLabel('Bot Token').fill('cold-secret');
  await page.getByLabel('Chat ID').fill('cold-chat');
  await page.getByRole('button', { name: '保存配置' }).click();
  await expect(selector.locator('option')).toHaveCount(2);
  await expect(page.getByLabel('Bot Token')).toHaveValue('********');

  await page.unroute(STORED_TEST_ROUTE);
  await page.route(STORED_TEST_ROUTE, async (route) => {
    await route.fulfill({ json: { result: null } });
  });
  await page.getByTestId('storage-profile-test').click();
  await expect(page.getByText('STORAGE_TEST_RESPONSE_INVALID')).toBeVisible();

  await createR2(request, 'Primary R2');
  const referencedR2 = await createR2(request, 'Referenced R2');
  await createReferencedR2File(request, referencedR2.id);
  await page.reload();
  await expect(selector.locator('option')).toHaveCount(4);
  await selector.selectOption(referencedR2.id);
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByTestId('storage-profile-delete').click();
  await expect(page.getByText('STORAGE_PROFILE_IN_USE')).toBeVisible();
  await expect(selector.locator(`option[value="${referencedR2.id}"]`)).toHaveCount(1);
});
