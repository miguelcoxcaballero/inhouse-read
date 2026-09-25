import { defineConfig, devices } from '@playwright/test'

const PORT = 4173
const BASE_URL = `http://127.0.0.1:${PORT}/inhouse-read/`

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /.*\.spec\.mjs/,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // El build se hace aparte (ver package.json: "pretest:e2e") — encadenar
    // "npm run build && npm run preview" en un solo comando no arrancaba de
    // forma fiable el proceso hijo de Playwright en todos los shells.
    command: `npm run preview -- --port ${PORT} --strictPort`,
    url: BASE_URL,
    timeout: 30_000,
    reuseExistingServer: !process.env.CI
  }
})
