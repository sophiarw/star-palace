import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './tests/website',
  outputDir: 'test-results/site',
  testMatch: '*.spec.ts',
  timeout: 30000,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:5180', channel: process.env.CI ? 'chromium' : 'chrome', viewport: { width: 1440, height: 1000 }, trace: 'retain-on-failure' },
  webServer: { command: 'npm run dev:site -- --strictPort', url: 'http://127.0.0.1:5180', reuseExistingServer: !process.env.CI },
})
