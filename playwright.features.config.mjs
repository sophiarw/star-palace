import config from './playwright.config.mjs'
process.env.STARPALACE_TEST_API = 'http://127.0.0.1:7378/api/atlas'
export default { ...config, testMatch: process.env.STARPALACE_FULL_BROWSER ? undefined : ['releaseFeatures.spec.ts', 'solarSystem.spec.ts'], use: { ...config.use, baseURL: 'http://127.0.0.1:5178' }, webServer: [
  { command: 'STARPALACE_DEMO_DIR=.atlas-dev/features node --import tsx scripts/seed-atlas.ts && STARPALACE_DIR=.atlas-dev/features STARPALACE_PORT=7378 STARPALACE_WEB_PORT=5178 npm start', url: 'http://127.0.0.1:5178', reuseExistingServer: true, timeout: 60000 },
] }
