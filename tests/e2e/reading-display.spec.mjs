import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'

test.use({ viewport:{ width:390, height:844 }, isMobile:true, hasTouch:true, deviceScaleFactor:1 })

// The Android shell with a stable top inset draws the page behind its status
// bar (the top STATUS_BAR px of this viewport) and never resizes it. This fake
// shell records each reader-ownership change with the layout at that instant
// and paints a status bar over the page for the screenshots.
const STATUS_BAR = 32
const shots = process.env.IHR_STATUSBAR_SHOTS
for (const { name, scheme, readingTheme, viewport } of [
  { name:'claro, vertical', scheme:'light', readingTheme:'paper', viewport:{ width:390, height:844 } },
  { name:'oscuro, papel nocturno', scheme:'dark', readingTheme:'night', viewport:{ width:390, height:844 } },
  { name:'claro, horizontal', scheme:'light', readingTheme:'sepia', viewport:{ width:844, height:390 } },
]) test(`Android con inset estable (${name}): la barra de estado se oculta y vuelve sin mover nada`, async ({ page }) => {
  test.setTimeout(180_000)
  await page.setViewportSize(viewport)
  await page.emulateMedia({ reducedMotion:'reduce', colorScheme:scheme })
  await page.addInitScript(({ top, readingTheme }) => {
    try { localStorage.setItem('inhouse-read-reading-preferences', JSON.stringify({ theme:readingTheme })) } catch { /* storage blocked */ }
    const box = selector => {
      const rect = document.querySelector(selector)?.getBoundingClientRect()
      return rect && rect.width ? [rect.left, rect.top, rect.width, rect.height] : null
    }
    const pageCanvas = () => document.querySelector('.pdf-page-wrap:not([hidden]) .pdf-page-canvas')
    const layout = () => ({
      header:box('.app-header'), logo:box('.app-header .logo'), back:box('#reader-back'),
      viewport:box('#reader-viewport'), page:box('.pdf-page-wrap:not([hidden]) .pdf-page-canvas'),
      pixels:pageCanvas() ? [pageCanvas().width, pageCanvas().height] : null,
      shelf:box('.ihr-bookshelf__scroll'), scene:box('canvas.ihr-bookshelf-scene'), innerHeight
    })
    window.__bar = { owner:[], light:[], canvases:[], layout, pageCanvas }
    window.InhouseNative = {
      getSafeTopInset:() => top,
      setReaderOwnership(enabled) {
        window.__bar.owner.push({ enabled, classes:document.body.className, layout:layout() })
        window.__bar.canvases.push(pageCanvas())
        document.documentElement.toggleAttribute('data-fake-bar-hidden', enabled)
      },
      setReadingMode() { throw new Error('A stable shell is driven by setReaderOwnership') },
      setStatusBarAppearance(light) {
        window.__bar.light.push({ light, classes:document.body.className })
        document.documentElement.dataset.fakeBarLight = String(light)
      }
    }
    document.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style')
      style.textContent = `#fake-status-bar { position:fixed; inset:0 0 auto; height:${top}px; z-index:2147483647; pointer-events:none;
        display:flex; align-items:center; justify-content:space-between; padding:0 18px; font:600 13px system-ui,sans-serif; color:#1b1b1b; }
        html[data-fake-bar-light=false] #fake-status-bar { color:#f4f4f4; }
        html[data-fake-bar-hidden] #fake-status-bar { opacity:0; }`
      const bar = document.createElement('div')
      bar.id = 'fake-status-bar'; bar.innerHTML = '<span>12:30</span><span>&#9660; &#9650; &#9646;</span>'
      document.head.append(style); document.documentElement.append(bar)
    })
  }, { top:STATUS_BAR, readingTheme })
  const shot = async label => {
    if (!shots) return
    mkdirSync(shots, { recursive:true })
    await page.screenshot({ path:join(shots, `${scheme}-${viewport.width}x${viewport.height}-${label}.png`) })
  }
  const layout = () => page.evaluate(() => window.__bar.layout())
  const lastOwner = () => page.evaluate(() => window.__bar.owner.at(-1))
  const lightIcons = () => page.evaluate(() => window.__bar.light.at(-1)?.light)
  const readerLight = () => page.evaluate(() => document.getElementById('reader-screen').style.colorScheme !== 'dark')
  // The paper is applied while the book opens, after the bar may hide: wait
  // for the icons that match this test's paper, then check the reader agrees.
  const readerIcons = async () => {
    await expect.poll(lightIcons).toBe(readingTheme !== 'night')
    expect(await readerLight()).toBe(readingTheme !== 'night')
  }
  const expectReaderTop = reader => {
    // The reader keeps the bar's strip in its header, hidden bar or not.
    expect(reader.header[1]).toBe(0)
    expect(reader.header[3]).toBe(48 + STATUS_BAR)
    expect(reader.back[1]).toBeGreaterThanOrEqual(STATUS_BAR)
    expect(reader.viewport[1]).toBe(48 + STATUS_BAR)
  }
  const stable = ({ header, logo, back, viewport:box, page:sheet, pixels, shelf, scene }) => ({ header, logo, back, viewport:box, page:sheet, pixels, shelf, scene })

  await page.goto(process.env.IHR_TEST_URL || './')
  await expect(page.locator('.ihr-bookshelf__scroll')).toBeVisible({ timeout:60_000 })
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--ihr-safe-top').trim())).toBe(`${STATUS_BAR}px`)
  const shelfBefore = await layout()
  expect(shelfBefore.header[1]).toBe(0)
  expect(shelfBefore.logo[1]).toBeGreaterThanOrEqual(STATUS_BAR)
  expect(await lightIcons()).toBe(scheme === 'light')
  expect((await lastOwner()).enabled).toBe(false)
  await shot('1-estanteria-barra-visible')

  // A direct import opens without the 3D book: the bar hides once reading.
  await page.locator('#file-picker').setInputFiles('tests/e2e/fixtures/tiny.pdf')
  await expect(page.locator('.pdf-page-canvas')).toBeVisible()
  await expect.poll(async () => (await lastOwner()).enabled).toBe(true)
  await readerIcons()
  const direct = await layout()
  expectReaderTop(direct)
  await shot('2-lector-barra-oculta')
  // A transient swipe shows the bar over the reserved strip; nothing moves.
  await page.evaluate(() => document.documentElement.removeAttribute('data-fake-bar-hidden'))
  await shot('3-lector-barra-revelada')
  expect(stable(await layout())).toEqual(stable(direct))
  await page.evaluate(() => document.documentElement.setAttribute('data-fake-bar-hidden', ''))

  // The import is saved (the back button needs its record) once the toolbar shows.
  await expect(page.locator('#reader-toolbar')).toBeVisible()
  await page.locator('#reader-back').click()
  await expect(page.locator('body')).not.toHaveClass(/is-closing-reader|is-reading/, { timeout:30_000 })
  const closeDirect = await lastOwner()
  expect(closeDirect.enabled).toBe(false)
  // Shown again as the page is handed to the book, before the return ends.
  expect(closeDirect.classes).toMatch(/is-closing-reader/)
  expect(closeDirect.classes).toMatch(/is-reader-page-leaving/)
  await expect.poll(lightIcons).toBe(scheme === 'light')
  const shelfAfter = await layout()
  expect(stable(shelfAfter).header).toEqual(shelfBefore.header)
  expect(stable(shelfAfter).logo).toEqual(shelfBefore.logo)
  expect(stable(shelfAfter).shelf).toEqual(shelfBefore.shelf)
  expect(shelfAfter.innerHeight).toBe(shelfBefore.innerHeight)

  // The 3D opening hides the bar as the page starts zooming in. The layout at
  // that instant is the final reader layout, and the PDF is not drawn again.
  await page.locator('.ihr-spine').first().click()
  await expect(page.locator('.ihr-flyout__cover-target')).toBeVisible({ timeout:30_000 })
  expect((await lastOwner()).enabled).toBe(false)
  await shot('4-portada-barra-visible')
  await page.locator('.ihr-flyout__cover-target').click()
  await expect(page.locator('.ihr-flyout')).toHaveCount(0, { timeout:30_000 })
  await expect(page.locator('body')).toHaveClass(/is-reading/)
  const opening = await lastOwner()
  expect(opening.enabled).toBe(true)
  expect(opening.classes).toMatch(/is-opening-reader/)
  expect(opening.classes).toMatch(/is-reader-page-arriving/)
  const opened = await layout()
  expectReaderTop(opened)
  expect(stable(opening.layout)).toEqual(stable(opened))
  expect(await page.evaluate(() => window.__bar.canvases.at(-1) === window.__bar.pageCanvas())).toBe(true)
  await readerIcons()
  await shot('5-lector-tras-abrir')

  await page.locator('#reader-back').click()
  await expect(page.locator('body')).not.toHaveClass(/is-closing-reader|is-reading/, { timeout:30_000 })
  const closing = await lastOwner()
  expect(closing.enabled).toBe(false)
  expect(closing.classes).toMatch(/is-closing-reader/)
  expect(closing.classes).toMatch(/is-reader-page-leaving/)
  const shelfEnd = await layout()
  expect(closing.layout.header).toEqual(shelfEnd.header)
  expect(shelfEnd.header).toEqual(shelfBefore.header)
  expect(shelfEnd.shelf).toEqual(shelfBefore.shelf)
  if (closing.layout.scene && shelfEnd.scene) expect(closing.layout.scene).toEqual(shelfEnd.scene)
  await expect.poll(lightIcons).toBe(scheme === 'light')
  await shot('6-estanteria-tras-cerrar')
  // Exactly one hide and one show per reading, and never the legacy setter.
  expect(await page.evaluate(() => window.__bar.owner.map(entry => entry.enabled).filter((value, index, all) => index === 0 || value !== all[index - 1])))
    .toEqual([false, true, false, true, false])
})

// APK 1.1.7 owns the reader display but has no stable inset: its WebView still
// moves when the bar hides, so the web keeps today's look and today's timing,
// never during a 3D flight (a resize there cancels it).
test('Android 1.1.7 (sin inset estable): la barra cambia sólo fuera de las animaciones del libro', async ({ page }) => {
  test.setTimeout(120_000)
  await page.emulateMedia({ reducedMotion:'reduce' })
  await page.addInitScript(() => {
    window.__owner = []
    window.InhouseNative = {
      setReaderOwnership(enabled) {
        window.__owner.push({ enabled, classes:document.body.className })
        requestAnimationFrame(() => window.dispatchEvent(new Event('resize')))
      },
      setReadingMode() { throw new Error('APK 1.1.7 is driven by setReaderOwnership') }
    }
  })
  await page.goto(process.env.IHR_TEST_URL || './')
  await expect(page.locator('.ihr-bookshelf__scroll')).toBeVisible({ timeout:60_000 })
  // No native value: the page keeps env(safe-area-inset-top), 0 in that shell.
  expect(await page.evaluate(() => document.documentElement.style.getPropertyValue('--ihr-safe-top'))).toBe('')
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('.app-header')).paddingTop)).toBe('10px')
  await page.locator('#file-picker').setInputFiles('tests/e2e/fixtures/tiny.pdf')
  await expect(page.locator('.pdf-page-canvas')).toBeVisible()
  // The import is saved (the back button needs its record) once the toolbar shows.
  await expect(page.locator('#reader-toolbar')).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.__owner.at(-1)?.enabled)).toBe(true)
  await page.locator('#reader-back').click()
  await expect(page.locator('body')).not.toHaveClass(/is-closing-reader|is-reading/, { timeout:30_000 })
  await expect.poll(() => page.evaluate(() => window.__owner.at(-1)?.enabled)).toBe(false)
  await page.locator('.ihr-spine').first().click()
  await page.locator('.ihr-flyout__cover-target').click({ timeout:30_000 })
  await expect(page.locator('.ihr-flyout')).toHaveCount(0, { timeout:30_000 })
  await expect(page.locator('body')).toHaveClass(/is-reading/)
  await expect.poll(() => page.evaluate(() => window.__owner.at(-1)?.enabled)).toBe(true)
  await page.locator('#reader-back').click()
  await expect(page.locator('body')).not.toHaveClass(/is-closing-reader|is-reading/, { timeout:30_000 })
  const owner = await page.evaluate(() => window.__owner)
  expect(owner.map(entry => entry.enabled).filter((value, index, all) => index === 0 || value !== all[index - 1]))
    .toEqual([false, true, false, true, false])
  expect(owner.every(entry => !/is-opening-reader|is-closing-reader|is-reader-page-/.test(entry.classes))).toBe(true)
})

// A centred dialog (the plant catalogue) lies below the strip the page keeps
// free, not under the status bar drawn over the page; without the shell it
// keeps its margins (6 px on narrow phones, 8 px otherwise).
for (const { viewport, gap } of [{ viewport:{ width:390, height:844 }, gap:6 }, { viewport:{ width:844, height:390 }, gap:8 }]) test(`Android con inset estable (${viewport.width}x${viewport.height}): el catálogo centrado no queda bajo la barra de estado`, async ({ page }) => {
  await page.setViewportSize(viewport)
  const place = () => page.evaluate(() => {
    const dialog = document.createElement('dialog')
    dialog.className = 'ihr-plant-catalog'
    document.body.append(dialog); dialog.showModal()
    for (const animation of dialog.getAnimations()) animation.finish() // its open scale
    const { top, bottom } = dialog.getBoundingClientRect()
    dialog.close(); dialog.remove()
    return { top, bottom, height:innerHeight }
  })
  await page.goto(process.env.IHR_TEST_URL || './')
  await expect(page.locator('.ihr-bookshelf__scroll')).toBeVisible({ timeout:60_000 })
  const browser = await place()
  expect(browser.top).toBeCloseTo(gap, 0)
  expect(browser.height - browser.bottom).toBeCloseTo(gap, 0)
  await page.evaluate(top => window.inhouseSetSafeTop(top), STATUS_BAR)
  const shell = await place()
  expect(shell.top).toBeCloseTo(STATUS_BAR + gap, 0)
  expect(shell.height - shell.bottom).toBeCloseTo(gap, 0)
})

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
