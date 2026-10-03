import { defineConfig, devices } from '@playwright/test'

// A dedicated port and a fresh server keep tests from attaching to an unrelated
// preview left running by another task. Parallel local runs can choose a port.
const PORT = Number(process.env.PLAYWRIGHT_PORT || 4283)
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) throw new Error('PLAYWRIGHT_PORT must be a valid TCP port')
const BASE_URL = `http://127.0.0.1:${PORT}/inhouse-read/`
const SUITE = process.env.PLAYWRIGHT_SUITE || 'all'
const REAL_SPECS = {
  engine: /[/\\]neural-voice-engine\.spec\.mjs$/,
  reading: /[/\\]neural-(voice-reading|page-follow)\.spec\.mjs$/,
  languages: /[/\\]neural-voice-languages\.spec\.mjs$/,
  supertonic: /[/\\]supertonic-voices\.spec\.mjs$/
}
if (!['all', 'general', ...Object.keys(REAL_SPECS)].includes(SUITE)) throw new Error(`Unknown PLAYWRIGHT_SUITE: ${SUITE}`)

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: REAL_SPECS[SUITE] || /.*\.spec\.mjs/,
  ...(SUITE === 'general' ? { testIgnore: /[/\\](neural-(voice-(engine|reading|languages)|page-follow)|supertonic-voices)\.spec\.mjs$/ } : {}),
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
    //
    // "--host 127.0.0.1" es imprescindible: sin él, "vite preview" resuelve
    // el hostname "localhost" y en systemd-resolved (runners de GitHub
    // Actions incluidos) eso puede enlazar solo IPv6 (::1). Playwright
    // comprueba la URL por IPv4 (127.0.0.1) y se queda esperando un socket
    // que nunca responde -> "Timed out waiting ...ms from config.webServer"
    // aunque el proceso arrancara bien y sin errores.
    command: `npm run preview -- --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: BASE_URL,
    timeout: 30_000,
    reuseExistingServer: false
  }
})
