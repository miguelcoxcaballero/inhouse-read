import {installEmptyUpdateChannels} from './helpers/empty-update-channels.mjs'
installEmptyUpdateChannels()
import { expect, test } from '@playwright/test'

// The reader's hold on the display is a Rust object (RustReadingDisplay) whose JavaScript handle
// app.js never reads again. Garbage collection of that handle must not free the controller: its
// observers and listeners keep working for the whole session and never call a released closure.
test.use({ viewport:{ width:390, height:844 }, isMobile:true, hasTouch:true, deviceScaleFactor:1 })

test('la pantalla de lectura sigue funcionando después de una recolección de basura', async ({ page }) => {
  test.setTimeout(120_000)
  const errors = []; page.on('pageerror', error => errors.push(error.message))
  await page.emulateMedia({ reducedMotion:'reduce' })
  await page.addInitScript(() => {
    window.__display = { requests:0, active:0 }
    Object.defineProperty(navigator, 'wakeLock', { configurable:true, value:{ request:async () => {
      const sentinel = new EventTarget()
      window.__display.requests++; window.__display.active++
      sentinel.release = async () => { window.__display.active--; sentinel.dispatchEvent(new Event('release')) }
      return sentinel
    } } })
  })
  await page.goto(process.env.IHR_TEST_URL || './')
  await expect(page.locator('.ihr-bookshelf-scene, .ihr-bookshelf').first()).toBeVisible({ timeout:60_000 })
  // Collect everything unreachable and give the finalizers their turn.
  const cdp = await page.context().newCDPSession(page)
  for (let round = 0; round < 3; round++) {
    await cdp.send('HeapProfiler.collectGarbage')
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 300)))
  }
  // The observers still watch the body and the root: changes there must not reach a freed closure.
  await page.evaluate(() => {
    document.body.classList.add('zz-gc-probe'); document.body.classList.remove('zz-gc-probe')
    const root = document.documentElement, theme = root.dataset.theme
    root.dataset.theme = theme === 'dark' ? 'light' : 'dark'
    if (theme === undefined) delete root.dataset.theme
    else root.dataset.theme = theme
  })
  await page.locator('#file-picker').setInputFiles('tests/e2e/fixtures/tiny.pdf')
  await expect(page.locator('.pdf-page-canvas')).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.__display.active)).toBe(1)
  expect(errors).toEqual([])
})
