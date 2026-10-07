import { defineConfig, devices } from '@playwright/test'

const PORT = 4409
const BASE_URL = `http://127.0.0.1:${PORT}/inhouse-read/`

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /.*\.spec\.mjs/,
  timeout: 280_000,
  expect: { timeout: 90_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  use: {
    launchOptions: { executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell', args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] },
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
