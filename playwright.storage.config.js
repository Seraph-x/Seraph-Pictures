const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './e2e',
  testMatch: 'storage-runtime.spec.js',
  workers: 1,
  fullyParallel: false,
  timeout: 90_000,
  use: {
    baseURL: 'http://127.0.0.1:4184',
    browserName: 'chromium',
    channel: 'chrome',
    locale: 'zh-CN',
    timezoneId: 'Asia/Singapore',
  },
  webServer: {
    command: 'node e2e/start-storage-runtime.mjs',
    url: 'http://127.0.0.1:4184/api/auth/check',
    reuseExistingServer: false,
    timeout: 45_000,
  },
});
