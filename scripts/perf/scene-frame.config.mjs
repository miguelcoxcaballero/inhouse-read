import { defineConfig, devices } from '@playwright/test'
import { fileURLToPath } from 'node:url'

// Local CPU profile of the shelf scene's frames (not part of CI). Serve an already built
// dist (PERF_DIST, default ./dist) with its own port so concurrent runs never share a server:
//   PERF_DIST=/path/dist PERF_PORT=4471 PERF_OUT=/tmp/a.json npx playwright test -c scripts/perf/scene-frame.config.mjs
const PORT = Number(process.env.PERF_PORT || 4471)
const DIST = process.env.PERF_DIST || 'dist'
const root = fileURLToPath(new URL('../..', import.meta.url))

export default defineConfig({
  testDir: '.',
  // PERF_SPEC=startup profiles a warm reload instead of the frame scenarios.
  testMatch: process.env.PERF_SPEC === 'startup' ? /scene-startup\.spec\.mjs$/ : /scene-frame\.spec\.mjs$/,
  timeout: 600_000,
  expect: { timeout: 60_000 },
  workers: 1,
  globalSetup: './browser-lock.mjs',
  use: {
    launchOptions: { executablePath: process.env.PERF_CHROME || '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell',
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
    baseURL: `http://127.0.0.1:${PORT}/inhouse-read/`
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npx vite preview --host 127.0.0.1 --port ${PORT} --strictPort --outDir ${JSON.stringify(DIST)}`,
    cwd: root,
    url: `http://127.0.0.1:${PORT}/inhouse-read/`,
    timeout: 60_000,
    reuseExistingServer: false
  }
})
