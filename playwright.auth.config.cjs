const { defineConfig } = require('@playwright/test');
const common = require('./playwright.config.cjs');
module.exports = defineConfig({ ...common, testDir: './security/browser', workers: 1 });
