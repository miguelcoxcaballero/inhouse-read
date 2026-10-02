import { expect, test } from '@playwright/test'

test.use({ viewport:{ width:390, height:844 }, isMobile:true, hasTouch:true, deviceScaleFactor:1 })

for (const native of [false, true]) test(`${native ? 'Android' : 'web'}: la pantalla permanece encendida sólo al leer y las transiciones conservan su tamaño`, async ({ page }) => {
  test.setTimeout(120_000)
  await page.emulateMedia({ reducedMotion:'reduce' })
  await page.addInitScript(native => {
    window.__display = { requests:0, releases:0, active:0, native:[], visibility:'visible' }
    Object.defineProperty(document, 'visibilityState', { configurable:true, get:() => window.__display.visibility })
    Object.defineProperty(navigator, 'wakeLock', { configurable:true, value:{ request:async () => {
      const sentinel = new EventTarget()
      let released = false
      window.__display.requests++; window.__display.active++
      sentinel.release = async () => {
        if (released) return
        released = true; window.__display.releases++; window.__display.active--
        sentinel.dispatchEvent(new Event('release'))
      }
      return sentinel
    } } })
    if (native) window.InhouseNative = { setReadingMode(enabled) {
      window.__display.native.push({ enabled, classes:document.body.className })
      // System-bar insets change the native viewport. A resulting resize must
      // not cancel a book still opening/returning to the shelf.
      requestAnimationFrame(() => window.dispatchEvent(new Event('resize')))
    } }
  }, native)
  await page.goto(process.env.IHR_TEST_URL || './')
  expect(await page.evaluate(() => window.__display.active)).toBe(0)
  // Initialisation and pageshow both restore the native policy, including a
  // possible back/forward-cache restore. Both must leave the shelf normal.
  const initialNative = await page.evaluate(() => window.__display.native)
  if (native) {
    expect(initialNative.length).toBeGreaterThan(0)
    expect(initialNative.every(event => event.enabled === false)).toBe(true)
  }
  await page.locator('#file-picker').setInputFiles('tests/e2e/fixtures/tiny.pdf')
  await expect(page.locator('.pdf-page-canvas')).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.__display.active)).toBe(1)

  // Backgrounding releases both policies, and returning to this reader takes
  // a new lock without requiring another tap or restarting the document.
  await page.evaluate(() => { window.__display.visibility = 'hidden'; document.dispatchEvent(new Event('visibilitychange')) })
  await expect.poll(() => page.evaluate(() => window.__display.active)).toBe(0)
  await page.evaluate(() => { window.__display.visibility = 'visible'; document.dispatchEvent(new Event('visibilitychange')) })
  await expect.poll(() => page.evaluate(() => window.__display.active)).toBe(1)

  await page.locator('#reader-back').click()
  await expect(page.locator('body')).not.toHaveClass(/is-closing-reader|is-reading/, { timeout:30_000 })
  await expect.poll(() => page.evaluate(() => window.__display.active)).toBe(0)
  await page.locator('.ihr-spine').first().click()
  await expect(page.locator('.ihr-flyout__cover-target')).toBeVisible({ timeout:30_000 })
  expect(await page.evaluate(() => window.__display.active)).toBe(0)
  await page.locator('.ihr-flyout__cover-target').click()
  await expect(page.locator('.ihr-flyout')).toHaveCount(0, { timeout:30_000 })
  await expect.poll(() => page.evaluate(() => window.__display.active)).toBe(1)
  await expect(page.locator('body')).toHaveClass(/is-reading/)
  await page.locator('#reader-back').click()
  await expect(page.locator('body')).not.toHaveClass(/is-closing-reader|is-reading/, { timeout:30_000 })
  await expect.poll(() => page.evaluate(() => window.__display.active)).toBe(0)
  const display = await page.evaluate(() => window.__display)
  expect(display.requests).toBe(3)
  expect(display.releases).toBe(3)
  if (native) {
    expect(display.native.slice(initialNative.length).map(event => event.enabled)).toEqual([true, false, true, false, true, false])
    expect(display.native.every(event => !/is-opening-reader|is-closing-reader/.test(event.classes))).toBe(true)
  }
})
