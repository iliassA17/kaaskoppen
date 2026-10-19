const { defineConfig } = require('@playwright/test');
const { existsSync } = require('node:fs');

module.exports = defineConfig({
  testDir: './tests',
  workers: 2,
  use: {
    baseURL: 'http://127.0.0.1:8765',
    serviceWorkers: 'block',
    launchOptions: {
      executablePath: process.env.CHROMIUM_PATH ||
        (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
    },
  },
  webServer: {
    command: 'python3 -m http.server 8765 --bind 127.0.0.1',
    url: 'http://127.0.0.1:8765',
    reuseExistingServer: false,
  },
});
