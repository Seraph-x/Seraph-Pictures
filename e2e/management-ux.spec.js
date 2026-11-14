const { test, expect } = require('@playwright/test');
const { fileRecord, installManagementFixtures } = require('./helpers/management-fixtures');

async function readyAdmin(page, count) {
  await page.goto('/admin');
  await page.waitForFunction((expected) => document.querySelector('#app').__vue__?.tableData.length === expected, count);
}

test('no-image mode suppresses thumbnails and media waits for playback', async ({ page }) => {
  const files = [fileRecord('photo.jpg', 'Photo.jpg'), fileRecord('movie.mp4', 'Movie.mp4'), fileRecord('song.mp3', 'Song.mp3')];
  const probe = await installManagementFixtures(page, { files, preferences: { loadMode: 'noImage' } });
  await readyAdmin(page, files.length);
  await expect(page.locator('.media-placeholder').first()).toBeVisible();
  await page.waitForLoadState('networkidle');
  expect(probe.mediaRequests).toEqual([]);
  await expect(page.locator('.video-card video')).toHaveAttribute('preload', 'none');
  await expect(page.locator('.audio-card audio')).toHaveAttribute('preload', 'none');
});

test('opaque IDs render the right type and pagination reuses the sorted list', async ({ page }) => {
  const files = Array.from({ length: 60 }, (_, i) => fileRecord(`r2:opaque-${i}`, `Photo ${i}.jpg`));
  await installManagementFixtures(page, { files, preferences: { loadMode: 'noImage' } });
  await readyAdmin(page, files.length);
  await expect(page.locator('.image-card').first()).toBeVisible();
  const sorts = await page.evaluate(async () => {
    const app = document.querySelector('#app').__vue__;
    let count = 0;
    const original = app.sortData;
    app.sortData = function (...args) { count++; return original.apply(this, args); };
    void app.paginatedTableData;
    for (let index = 0; index < 12; index++) {
      app.currentPage = index % 2 + 1;
      void app.paginatedTableData;
      await app.$nextTick();
    }
    return count;
  });
  expect(sorts).toBeLessThanOrEqual(1);
});

test('upload loads profiles while storage status is pending', async ({ page }) => {
  let finishStatus;
  const statusGate = new Promise((resolve) => { finishStatus = resolve; });
  const probe = await installManagementFixtures(page, { statusGate, preferences: { storageMode: 'r2' } });
  try {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect.poll(() => probe.requests.includes('/api/storage/list')).toBe(true);
  } finally { finishStatus(); }
  await expect(page.locator('[data-storage-profile-select]')).toHaveValue('r2-main');
});

test('data saver and safe mode hide thumbnails but allow an explicit preview', async ({ page }) => {
  const files = [
    fileRecord('r2:small', 'Small.jpg'),
    fileRecord('r2:large', 'Large.jpg', { fileSize: 6 * 1024 * 1024 }),
    fileRecord('r2:adult', 'Private.jpg', { Label: 'adult' }),
  ];
  const probe = await installManagementFixtures(page, { files, preferences: { loadMode: 'dataSaver' } });
  await readyAdmin(page, files.length);
  const headerContainsTools = await page.evaluate(() => {
    const header = document.querySelector('.header-content').getBoundingClientRect();
    const tools = document.querySelector('.admin-header-tools').getBoundingClientRect();
    return tools.bottom <= header.bottom;
  });
  expect(headerContainsTools).toBe(true);
  await expect(page.locator('.media-placeholder')).toHaveCount(2);
  await expect.poll(() => probe.mediaRequests.includes('/file/r2:small')).toBe(true);
  expect(probe.mediaRequests).not.toContain('/file/r2:large');
  expect(probe.mediaRequests).not.toContain('/file/r2:adult');
  await page.locator('.image-card').filter({ hasText: 'Large.jpg' }).locator('.media-placeholder button').click();
  await expect(page.locator('.preview-modal img')).toHaveAttribute('src', /\/file\/r2:large$/);
  await expect.poll(() => probe.mediaRequests.includes('/file/r2:large')).toBe(true);
  await page.locator('.preview-close').click();
  await expect(page.locator('.preview-modal')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test('a saved filter with no matches stays active and reset is explicit', async ({ page }) => {
  const probe = await installManagementFixtures(page, {
    files: [fileRecord('r2:photo', 'Photo.jpg')], preferences: { fileType: 'audio' },
  });
  await readyAdmin(page, 1);
  await expect(page.locator('.empty-tip')).toBeVisible();
  expect(probe.requests.filter((path) => path === '/api/drive/explorer')).toHaveLength(1);
  expect(await page.evaluate(() => document.querySelector('#app').__vue__.fileType)).toBe('audio');
  await page.locator('.empty-tip button').click();
  await expect(page.locator('.image-card')).toBeVisible();
});

test('changing storage while profiles load recovers a valid upload target', async ({ page }) => {
  let finishProfiles;
  const profilesGate = new Promise((resolve) => { finishProfiles = resolve; });
  await installManagementFixtures(page, { profilesGate });
  try {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('#app').__vue__?.r2Available);
    await page.evaluate(() => document.querySelector('#app').__vue__.setStorageMode('r2'));
  } finally { finishProfiles(); }
  await expect(page.locator('[data-storage-profile-select]')).toHaveValue('r2-main');
  await expect(page.locator('.storage-profile-notice[role="alert"]')).toHaveCount(0);
});
