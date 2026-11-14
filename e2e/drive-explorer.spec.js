const { test, expect } = require('@playwright/test');

function explorerPage(names, cursor = null) {
  return {
    success: true, folders: [],
    files: names.map((name) => ({ name, metadata: { fileName: name, storageType: 'r2', storageName: 'Archive' } })),
    cursor, list_complete: cursor === null,
  };
}

async function installDrive(page, options = {}) {
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    let body;
    let status = 200;
    switch (url.pathname) {
      case '/api/auth/check': body = { authRequired: false, authenticated: true }; break;
      case '/api/storage/list': body = { success: true, items: [] }; break;
      case '/api/status':
        status = options.statusFailed ? 503 : 200;
        body = options.statusFailed ? { error: 'STATUS_UNAVAILABLE' } : {};
        break;
      case '/api/drive/tree':
        if (options.tree) return options.tree(route);
        body = { nodes: [{ path: '', name: '全部文件' }, { path: 'photos', name: 'Photos' }] };
        break;
      case '/api/drive/explorer':
        if (options.explorer) return options.explorer(route, url.searchParams);
        body = explorerPage(['first.txt']);
        break;
      default: throw new Error(`Unexpected API request: ${url.pathname}`);
    }
    await route.fulfill({ status, json: body });
  });
}

test('search submission and pagination keep separate query states in list and grid views', async ({ page }) => {
  const requests = [];
  await installDrive(page, { explorer: async (route, query) => {
    requests.push(Object.fromEntries(query));
    const body = query.get('search') ? explorerPage([])
      : explorerPage(query.get('cursor') ? ['second.txt'] : ['first.txt'], query.get('cursor') ? null : 'page-2');
    await route.fulfill({ json: body });
  } });
  await page.goto('/app/drive');
  const browser = page.locator('.drive-main');
  await expect(browser.getByText('first.txt', { exact: true }).first()).toBeVisible();
  await page.getByRole('searchbox', { name: '搜索文件' }).fill('missing');
  await page.getByRole('button', { name: '加载更多', exact: true }).click();
  await expect(browser.getByText('second.txt', { exact: true }).first()).toBeVisible();
  expect(requests[1].search).toBeUndefined();
  expect(requests[1].cursor).toBe('page-2');
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  await expect(page.getByText('没有符合条件的文件。', { exact: true })).toBeVisible();
  await page.getByLabel('显示方式', { exact: true }).selectOption('grid');
  await expect(page.getByText('没有符合条件的文件。', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '清除筛选', exact: true }).click();
  await expect(browser.getByText('first.txt', { exact: true }).first()).toBeVisible();
  await page.getByRole('checkbox', { name: '选择全部已加载文件', exact: true }).check();
  await expect(page.getByText('已选择 1 个文件', { exact: true })).toBeVisible();
});

test('navigation clears old actions, exposes errors, and retries the failed directory', async ({ page }) => {
  let releaseFailure;
  const pending = new Promise((resolve) => { releaseFailure = resolve; });
  let attempts = 0;
  await installDrive(page, { explorer: async (route, query) => {
    if (!query.get('path')) return route.fulfill({ json: explorerPage(['old.txt']) });
    attempts += 1;
    if (attempts === 1) {
      await pending;
      return route.fulfill({ status: 503, json: { error: 'DIRECTORY_UNAVAILABLE' } });
    }
    return route.fulfill({ json: explorerPage(['recovered.txt']) });
  } });
  await page.goto('/app/drive');
  await page.getByRole('checkbox', { name: '选择 old.txt', exact: true }).check();
  await page.locator('.tree-link').filter({ hasText: 'Photos' }).click();
  const browser = page.locator('.drive-main');
  await expect(browser.getByRole('progressbar')).toBeVisible();
  await expect(browser.getByText('old.txt', { exact: true })).toHaveCount(0);
  await expect(page.locator('.drive-toolbar').getByRole('button', { name: '删除', exact: true })).toBeDisabled();
  releaseFailure();
  await expect(browser.getByRole('alert')).toContainText('DIRECTORY_UNAVAILABLE');
  await expect(browser.getByText('此文件夹中没有文件。', { exact: true })).toHaveCount(0);
  await browser.getByRole('button', { name: '重试', exact: true }).click();
  await expect(browser.getByText('recovered.txt', { exact: true }).first()).toBeVisible();
  await expect(browser.getByRole('alert')).toHaveCount(0);
});

test('tree failures retry independently without removing loaded files', async ({ page }) => {
  let attempts = 0;
  await installDrive(page, { tree: async (route) => {
    attempts += 1;
    if (attempts === 1) return route.fulfill({ status: 503, json: { error: 'TREE_UNAVAILABLE' } });
    return route.fulfill({ json: { nodes: [{ path: 'photos', name: 'Photos' }] } });
  } });
  await page.goto('/app/drive');
  await expect(page.locator('.drive-main').getByText('first.txt', { exact: true }).first()).toBeVisible();
  await expect(page.locator('.folder-tree').getByRole('alert')).toContainText('TREE_UNAVAILABLE');
  await page.locator('.folder-tree').getByRole('button', { name: '重试', exact: true }).click();
  await expect(page.locator('.tree-link').filter({ hasText: 'Photos' })).toBeVisible();
  await expect(page.locator('.drive-main').getByText('first.txt', { exact: true }).first()).toBeVisible();
});

test('storage status failure does not prevent browsing existing files', async ({ page }) => {
  await installDrive(page, { statusFailed: true });
  await page.goto('/app/drive');
  await expect(page.getByRole('alert').filter({ hasText: 'STATUS_UNAVAILABLE' })).toBeVisible();
  await expect(page.locator('.drive-main').getByText('first.txt', { exact: true }).first()).toBeVisible();
});

test('an empty intermediate page keeps pagination available instead of declaring an empty folder', async ({ page }) => {
  await installDrive(page, { explorer: async (route, query) => route.fulfill({
    json: query.get('cursor') ? explorerPage(['found.txt']) : explorerPage([], 'next'),
  }) });
  await page.goto('/app/drive');
  await expect(page.getByText('当前页暂无匹配文件，可继续加载。', { exact: true })).toBeVisible();
  await expect(page.getByText('此文件夹中没有文件。', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '加载更多', exact: true }).click();
  await expect(page.locator('.drive-main').getByText('found.txt', { exact: true }).first()).toBeVisible();
});
