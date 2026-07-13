const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { PNG } = require('pngjs');

const FIXTURE_PATH = path.resolve('e2e/fixtures/baseline.json');
const BASELINE_DIR = path.resolve('e2e/visual-baselines');
const MANIFEST_PATH = path.join(BASELINE_DIR, 'manifest.json');
const UPDATE_BASELINE = process.env.BASELINE_UPDATE === '1';
const MAX_PIXEL_DIFF_RATIO = 0.001;
const PIXEL_COLOR_THRESHOLD = 0.1;
const ROUTES = Object.freeze([
  { key: '/', url: '/' },
  { key: '/login', url: '/login' },
  { key: '/admin', url: '/admin' },
  { key: '/gallery', url: '/gallery' },
  { key: '/preview', url: '/preview?id=baseline.jpg' },
  { key: '/webdav', url: '/webdav' },
  { key: '/storage-settings', url: '/storage-settings' },
  { key: '/app/drive', url: '/app/drive' },
  { key: '/app/storage', url: '/app/storage' },
  { key: '/app/status', url: '/app/status' },
]);

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function loadManifest() {
  if (!fs.existsSync(MANIFEST_PATH)) return { schemaVersion: 1, entries: {} };
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
}

function saveManifest(manifest) {
  fs.mkdirSync(BASELINE_DIR, { recursive: true });
  fs.writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
}

async function installFixtures(page, fixture) {
  await page.addInitScript(() => {
    localStorage.setItem('kvUiDesignSettings', JSON.stringify({
      effectStyle: 'none',
      effectIntensity: 0,
      optimizeMobile: true,
    }));
  });
  await page.route('**/api/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const pagePath = new URL(route.request().frame().url()).pathname;
    let body = { success: true, data: [] };
    if (pathname === '/api/auth/check') {
      body = pagePath === '/login'
        ? { authRequired: true, authenticated: false }
        : fixture.auth;
    }
    if (pathname === '/api/status') body = fixture.status;
    if (pathname.includes('/manage/list')) body = { items: fixture.files, nextCursor: null };
    if (pathname.includes('/manage/folders')) body = { folders: fixture.folders };
    if (pathname === '/api/storage-config') body = fixture.storage;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.route('**/file/**', (route) => route.fulfill({ status: 404, body: '' }));
}

async function freezePage(page) {
  await page.waitForLoadState('networkidle');
  await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}' });
  await page.evaluate(async () => {
    await document.fonts?.ready;
    await Promise.all([...document.images].map((image) => image.decode().catch(() => undefined)));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await page.waitForTimeout(500);
}

async function readPageArtifact(page) {
  return page.evaluate(() => {
    const text = document.body.innerText.replace(/\s+/g, ' ').trim();
    const selectors = 'button,input,select,textarea,a,[role="button"]';
    const controlRectangles = [...document.querySelectorAll(selectors)].slice(0, 80).map((element) => {
      const rect = element.getBoundingClientRect();
      return [Math.round(rect.x), Math.round(rect.y), Math.round(rect.width), Math.round(rect.height)];
    });
    return { text, controlRectangles };
  });
}

async function compareScreenshot(actualBuffer, expectedPath) {
  const { default: pixelmatch } = await import('pixelmatch');
  const actual = PNG.sync.read(actualBuffer);
  const expected = PNG.sync.read(fs.readFileSync(expectedPath));
  expect([actual.width, actual.height]).toEqual([expected.width, expected.height]);
  const diffPixels = pixelmatch(actual.data, expected.data, null, actual.width, actual.height, {
    threshold: PIXEL_COLOR_THRESHOLD,
  });
  const ratio = diffPixels / (actual.width * actual.height);
  expect(ratio, `pixel diff ratio ${ratio}`).toBeLessThanOrEqual(MAX_PIXEL_DIFF_RATIO);
}

async function captureRoute({ page, route, projectName, manifest }) {
  await page.goto(route.url, { waitUntil: 'domcontentloaded' });
  await freezePage(page);
  const artifact = await readPageArtifact(page);
  const filename = `${projectName}-${route.key.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'root'}.png`;
  const screenshotPath = path.join(BASELINE_DIR, filename);
  const screenshot = await page.screenshot({ fullPage: true, animations: 'disabled' });
  const entry = {
    screenshot: filename,
    screenshotSha256: sha256(screenshot),
    textSha256: sha256(artifact.text),
    controlRectangles: artifact.controlRectangles,
  };
  if (UPDATE_BASELINE) fs.writeFileSync(screenshotPath, screenshot);
  const expected = manifest.entries[`${route.key}::${projectName}`];
  if (expected?.screenshotSha256 !== entry.screenshotSha256) {
    const debugPath = path.resolve('test-results', `actual-${filename}`);
    fs.mkdirSync(path.dirname(debugPath), { recursive: true });
    fs.writeFileSync(debugPath, screenshot);
  }
  expect(entry.screenshot).toBe(expected.screenshot);
  expect(entry.textSha256).toBe(expected.textSha256);
  expect(entry.controlRectangles).toEqual(expected.controlRectangles);
  expect(sha256(fs.readFileSync(screenshotPath))).toBe(expected.screenshotSha256);
  await compareScreenshot(screenshot, screenshotPath);
}

test.describe('immutable pre-phase-two visual baseline', () => {
  test('matches every route', async ({ page }, testInfo) => {
    const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));
    const manifest = loadManifest();
    manifest.fixtureSha256 = sha256(fs.readFileSync(FIXTURE_PATH));
    await installFixtures(page, fixture);

    if (UPDATE_BASELINE) {
      for (const route of ROUTES) {
        testInfo.annotations.push({ type: 'route', description: route.key });
        process.stdout.write(`[baseline] ${testInfo.project.name} ${route.key}\n`);
        await page.goto(route.url, { waitUntil: 'domcontentloaded' });
        await freezePage(page);
        const artifact = await readPageArtifact(page);
        const filename = `${testInfo.project.name}-${route.key.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'root'}.png`;
        const screenshot = await page.screenshot({ fullPage: true, animations: 'disabled' });
        fs.mkdirSync(BASELINE_DIR, { recursive: true });
        fs.writeFileSync(path.join(BASELINE_DIR, filename), screenshot);
        manifest.entries[`${route.key}::${testInfo.project.name}`] = {
          screenshot: filename,
          screenshotSha256: sha256(screenshot),
          textSha256: sha256(artifact.text),
          controlRectangles: artifact.controlRectangles,
        };
      }
      saveManifest(manifest);
      return;
    }

    for (const route of ROUTES) {
      await captureRoute({ page, route, projectName: testInfo.project.name, manifest });
    }
  });
});
