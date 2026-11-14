const { test, expect } = require('@playwright/test');
const { fileRecord, installManagementFixtures } = require('./helpers/management-fixtures');

async function openFiles(page) {
  await installManagementFixtures(page, {
    files: [fileRecord('r2:alpha', 'Alpha.jpg'), fileRecord('r2:beta', 'Beta.jpg')],
    preferences: { loadMode: 'noImage' },
  });
  await page.goto('/admin');
  await expect(page.locator('.image-card')).toHaveCount(2);
}

test('page destinations and search remain accessible at every size', async ({ page }) => {
  await openFiles(page);
  const nav = page.getByRole('navigation', { name: '主导航' });
  await expect(nav.getByRole('link')).toHaveCount(4);
  await expect(nav.locator('[aria-current="page"]')).toHaveAttribute('href', '/admin');
  for (const link of await nav.getByRole('link').all()) await expect(link).toBeVisible();
  const search = page.getByRole('searchbox', { name: '输入关键字搜索' });
  await expect(search).toBeVisible();
  await search.fill('Beta');
  await expect(page.locator('.image-card')).toHaveCount(1);
  await expect(page.locator('.image-card')).toContainText('Beta.jpg');
  await search.fill('');
  await expect(page.locator('.image-card')).toHaveCount(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test('view buttons and batch availability match the current selection', async ({ page }) => {
  await openFiles(page);
  await page.locator('[data-file-tool="handleBatchOperation"] button').click();
  const deletion = page.getByRole('menuitem', { name: '批量删除' });
  await expect(deletion).toHaveAttribute('aria-disabled', 'true');
  await page.getByRole('menuitem', { name: '全选当前页', exact: true }).click();
  await expect(page.locator('[data-file-tool="handleBatchOperation"] button')).toContainText('(2)');
  await page.locator('[data-file-tool="handleBatchOperation"] button').click();
  await expect(deletion).not.toHaveAttribute('aria-disabled', 'true');
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-file-tool="handleBatchOperation"] button')).toContainText('(2)');
  await page.getByRole('button', { name: '详细视图', exact: true }).click();
  await expect(page.locator('.list-view-card')).toBeVisible();
  await expect(page.getByRole('button', { name: '详细视图', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '平铺视图', exact: true }).click();
  await expect(page.locator('.image-card')).toHaveCount(2);
});

test('settings can be opened with a keyboard and expose storage configuration', async ({ page }) => {
  await openFiles(page);
  const settings = page.getByRole('button', { name: '系统设置', exact: true });
  await expect(settings).toHaveAttribute('aria-expanded', 'false');
  await settings.focus();
  await page.keyboard.press('Enter');
  await expect(settings).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('menuitem', { name: '存储配置', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(settings).toBeFocused();
  await expect(settings).toHaveAttribute('aria-expanded', 'false');
});
