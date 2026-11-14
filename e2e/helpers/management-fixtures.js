const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');

function fileRecord(name, fileName, overrides = {}) {
  return { name, metadata: {
    fileName, fileSize: 1024, TimeStamp: 1_800_000_000_000,
    storageType: 'r2', storageId: 'r2-main', storageName: 'Main',
    folderPath: '', visibility: 'private', liked: false, ...overrides,
  } };
}

async function installManagementFixtures(page, options = {}) {
  const requests = [];
  const mediaRequests = [];
  const files = options.files || [];
  await page.addInitScript((preferences) => {
    localStorage.setItem('kvUiDesignSettings', JSON.stringify({ effectStyle: 'none', effectIntensity: 0 }));
    for (const [key, value] of Object.entries(preferences)) localStorage.setItem(key, value);
  }, options.preferences || {});
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    requests.push(url.pathname);
    let body;
    if (url.pathname === '/api/auth/check') body = { authRequired: true, authenticated: true, user: 'admin' };
    if (url.pathname === '/api/ui-config') body = { success: true, config: {} };
    if (url.pathname === '/api/storage/list' && options.profilesGate) await options.profilesGate;
    if (url.pathname === '/api/storage/list') body = { success: true, items: [
      { id: 'tg-main', type: 'telegram', name: 'Primary', enabled: true, isDefault: true, config: {} },
      { id: 'r2-main', type: 'r2', name: 'Main', enabled: true, isDefault: true, config: {} },
    ] };
    if (url.pathname === '/api/status') {
      if (options.statusGate) await options.statusGate;
      body = { telegram: { enabled: true, connected: true }, r2: { enabled: true, connected: true }, auth: { enabled: true }, uploadLimits: {} };
    }
    if (url.pathname === '/api/drive/explorer') {
      if (options.listFailure) return route.fulfill({ status: 503, json: { success: false, error: { code: 'TEST_LIST_UNAVAILABLE' } } });
      body = { success: true, files, folders: [], currentPath: '', cursor: null, list_complete: true, stats: { total: files.length } };
    }
    if (url.pathname === '/api/manage/folders') body = { folders: [] };
    if (!body) throw new Error(`UNEXPECTED_TEST_API:${url.pathname}`);
    await route.fulfill({ json: body });
  });
  await page.route('**/file/**', (route) => {
    mediaRequests.push(new URL(route.request().url()).pathname);
    return route.fulfill({ contentType: 'image/png', body: PNG });
  });
  return { requests, mediaRequests };
}

module.exports = { fileRecord, installManagementFixtures };
