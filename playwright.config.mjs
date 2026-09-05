import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/browser',
  timeout: 30000,
  fullyParallel: false,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:5174', channel: 'chrome', viewport: { width: 1440, height: 960 }, trace: 'retain-on-failure' },
  webServer: [
    { command: 'node --import tsx scripts/seed-atlas.ts && STARPALACE_DIR=.atlas-dev STARPALACE_PORT=7374 node --import tsx src/daemon/index.ts', url: 'http://127.0.0.1:7374/api/atlas/summary', reuseExistingServer: !process.env.CI, timeout: 60000 },
    { command: 'VITE_DAEMON_PORT=7374 npm run dev:web -- --port 5174 --host 127.0.0.1', url: 'http://127.0.0.1:5174', reuseExistingServer: !process.env.CI },
  ],
})
