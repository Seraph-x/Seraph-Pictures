const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './e2e',
  testMatch: 'auth-coordinator.spec.js',
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  use: {
    baseURL: 'http://127.0.0.1:4182',
    browserName: 'chromium',
    channel: 'chrome',
    locale: 'zh-CN',
    timezoneId: 'Asia/Singapore',
  },
  webServer: {
    command: 'node e2e/start-auth-runtime.mjs',
    url: 'http://127.0.0.1:4182/login',
    reuseExistingServer: false,
    timeout: 45_000,
  },
});
