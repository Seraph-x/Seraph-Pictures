const { defineConfig, devices } = require('@playwright/test');

const BASE_URL = 'http://127.0.0.1:4181';

module.exports = defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL: BASE_URL,
    browserName: 'chromium',
    channel: 'chrome',
    launchOptions: {
      args: ['--disable-gpu', '--font-render-hinting=none'],
    },
    locale: 'zh-CN',
    timezoneId: 'Asia/Singapore',
    colorScheme: 'light',
    reducedMotion: 'reduce',
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 1000 } } },
    { name: 'mobile', use: { ...devices['iPhone 13'], channel: 'chrome' } },
  ],
  webServer: {
    command: 'node e2e/serve-baseline.mjs',
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
