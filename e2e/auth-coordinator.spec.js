const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');

const BASE_URL = 'http://127.0.0.1:4182';
const UNBOUND_URL = 'http://127.0.0.1:4183';
const RUNTIME_PATH = path.resolve('.wrangler/auth-e2e-runtime.json');
const EXPECTED_BROWSER_DIAGNOSTICS = new Set(['Transition was skipped']);

function collectBrowserErrors(page, allowedFailures = []) {
  const errors = [];
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    if (!message.text().startsWith('Failed to load resource:')) errors.push(`console:${message.text()}`);
  });
  page.on('pageerror', (error) => {
    if (!EXPECTED_BROWSER_DIAGNOSTICS.has(error.message)) errors.push(`page:${error.message}`);
  });
  page.on('requestfailed', (request) => {
    const url = new URL(request.url());
    errors.push(`requestfailed:${request.method()}:${url.pathname}:${request.failure()?.errorText}`);
  });
  page.on('response', (response) => {
    if (response.status() < 400) return;
    const key = `${response.status()}:${new URL(response.url()).pathname}`;
    if (!allowedFailures.includes(key)) errors.push(`response:${key}`);
  });
  return errors;
}

async function submitLogin(page, username, password) {
  await page.locator('#username').fill(username);
  await page.locator('#password').fill(password);
  await page.locator('#loginBtn').click();
}

async function expectOrdinaryLogin(browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = collectBrowserErrors(page);
  await page.goto(`${BASE_URL}/login`);
  await submitLogin(page, 'admin', 'replacement-password');
  await expect(page).toHaveURL(`${BASE_URL}/`);
  const check = await page.request.get('/api/auth/check');
  expect((await check.json()).authenticated).toBe(true);
  expect(errors).toEqual([]);
  await context.close();
}

async function expectMissingBindingError(browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = collectBrowserErrors(page, [
    '503:/api/auth/check',
    '503:/api/auth/login',
  ]);
  await page.goto(`${UNBOUND_URL}/login`);
  await submitLogin(page, 'admin', 'initial-password');
  await expect(page.locator('#errorMessage')).toHaveClass(/show/);
  const response = await context.request.get(`${UNBOUND_URL}/api/auth/check`);
  expect(response.status()).toBe(503);
  expect((await response.json()).error.code).toBe('AUTH_STATE_UNAVAILABLE');
  expect(errors).toEqual([]);
  await context.close();
}

test('real coordinator login, rotation, logout, and outage semantics', async ({ page, browser }) => {
  const browserErrors = collectBrowserErrors(page, ['401:/api/auth/login']);
  await page.goto('/login');
  await submitLogin(page, 'attacker', 'wrong-password');
  await expect(page.locator('#errorMessage')).toHaveClass(/show/);
  await expect(page).toHaveURL(/\/login$/);

  await submitLogin(page, 'admin', 'initial-password');
  await expect(page).toHaveURL(`${BASE_URL}/`);
  const oldCookies = await page.context().cookies();
  expect(oldCookies.some((cookie) => cookie.name === 'seraph_pictures_session')).toBe(true);
  const beforeChange = await page.request.get('/api/auth/check');
  expect(await beforeChange.json()).toMatchObject({ authenticated: true, reason: 'session' });

  const change = await page.request.post('/api/auth/credentials', {
    data: { currentPassword: 'initial-password', newPassword: 'replacement-password' },
  });
  const changeBody = await change.json();
  expect(change.status(), JSON.stringify(changeBody)).toBe(200);
  const currentCheck = await page.request.get('/api/auth/check');
  expect((await currentCheck.json()).authenticated).toBe(true);
  await expectOrdinaryLogin(browser);

  const oldContext = await browser.newContext();
  await oldContext.addCookies(oldCookies);
  const oldCheck = await oldContext.request.get(`${BASE_URL}/api/auth/check`);
  expect((await oldCheck.json()).authenticated).toBe(false);
  await oldContext.close();

  const logout = await page.request.post('/api/auth/logout');
  expect(logout.status()).toBe(200);
  const loggedOutCheck = await page.request.get('/api/auth/check');
  expect((await loggedOutCheck.json()).authenticated).toBe(false);
  await expectMissingBindingError(browser);

  const runtime = JSON.parse(fs.readFileSync(RUNTIME_PATH, 'utf8'));
  process.kill(runtime.coordinatorPid, 'SIGTERM');
  await page.waitForTimeout(500);
  const unavailable = await page.request.get('/api/auth/check');
  expect(unavailable.status()).toBe(503);
  expect((await unavailable.json()).error.code).toBe('AUTH_COORDINATOR_RESPONSE_INVALID');
  expect(browserErrors).toEqual([]);
});
