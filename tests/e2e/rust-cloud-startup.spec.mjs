import {installEmptyUpdateChannels} from './helpers/empty-update-channels.mjs'
installEmptyUpdateChannels()
import { test, expect } from '@playwright/test'
import { driveServer } from './helpers/drive-server.mjs'

if (process.env.IHR_TEST_URL) test.use({ baseURL: process.env.IHR_TEST_URL })

// The Drive logic is Rust (rust-ui). A returning person with a Google session must not make the
// app fetch that module before the first live shelf frame has been drawn, and the sync must still
// complete without a JavaScript copy: the account, the manifest of this device and the
// per-book progress reach the (simulated) Drive.
test('a returning Drive session loads the cloud module after the first shelf frame and syncs', async ({ browser }) => {
  test.setTimeout(150_000)
  const drive = driveServer()
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  await drive.connect(context)
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => {
    const probe = window.__cloudProbe = { frame: null, module: null }
    const poll = () => {
      const canvas = document.querySelector('canvas.ihr-bookshelf-scene')
      if (Number(canvas?.dataset.renderCount) > 0) { probe.frame = performance.now(); return }
      requestAnimationFrame(poll)
    }
    requestAnimationFrame(poll)
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) if (/inhouse_read_ui/.test(entry.name) && probe.module === null) probe.module = entry.startTime
    }).observe({ type: 'resource', buffered: true })
  })
  await page.goto('./')
  await expect.poll(() => page.evaluate(() => window.__cloudProbe.frame), { timeout: 90_000 }).not.toBeNull()
  // The account appears (the profile request is the first thing the session does) and the sync writes this device's manifest.
  await expect(page.getByRole('button', { name: 'Cuenta de Google: reader@example.com' })).toBeVisible({ timeout: 90_000 })
  await expect.poll(() => drive.manifests().length, { timeout: 90_000 }).toBeGreaterThan(0)
  const { frame, module } = await page.evaluate(() => window.__cloudProbe)
  expect(module).not.toBeNull()
  // Nothing of the module was requested while the shelf was still being drawn for the first time.
  expect(module).toBeGreaterThanOrEqual(frame - 50)
  expect(errors).toEqual([])
  await context.close()
})
