import { test, expect } from '@playwright/test'
import path from 'node:path'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PDF = path.join(__dirname, 'fixtures', 'tiny.pdf')

// The service worker would answer the held bundle request before page.route
// could see it, and a held bundle is how these tests observe the boot order.
test.use({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })

const meta = page => page.evaluate(() => JSON.parse(localStorage.getItem('ihr-poster-meta') || 'null'))

/** Holds the main bundle until release() is called: nothing of the app runs meanwhile. */
async function holdBundle(page) {
  let release
  const gate = new Promise(resolve => { release = resolve })
  await page.route('**/assets/main-*.js', async route => { await gate; await route.continue() })
  return release
}

async function settleAndStore(page) {
  await expect.poll(() => meta(page), { timeout: 120_000 }).not.toBeNull()
}

async function addBookAndGoHome(page) {
  await page.locator('#file-picker').setInputFiles(PDF)
  await expect(page.locator('body')).toHaveClass(/is-reading/, { timeout: 60_000 })
  await expect(page.locator('#reader-screen')).not.toHaveClass(/is-preparing|is-opening-from-book/, { timeout: 60_000 })
  await page.waitForTimeout(2000)
  await page.getByRole('button', { name: 'Volver a la estantería' }).click()
  await expect(page.locator('body')).toHaveClass(/is-closing-reader/)
  await expect(page.locator('body')).not.toHaveClass(/is-closing-reader/, { timeout: 60_000 })
  await expect(page.locator('.ihr-flyout')).toHaveCount(0)
}

async function pixelDifference(page, a, b, excludeBottom = 0) {
  return page.evaluate(async ([first, second, skip]) => {
    const decode = async data => createImageBitmap(await (await fetch('data:image/png;base64,' + data)).blob())
    const [x, y] = await Promise.all([decode(first), decode(second)])
    const read = bitmap => { const c = new OffscreenCanvas(bitmap.width, bitmap.height), g = c.getContext('2d'); g.drawImage(bitmap, 0, 0); return g.getImageData(0, 0, bitmap.width, bitmap.height).data }
    if (x.width !== y.width || x.height !== y.height) return { size: false }
    const p = read(x), q = read(y)
    let total = 0, large = 0
    const rows = x.height - skip
    for (let i = 0; i < rows * x.width * 4; i += 4) {
      const d = (Math.abs(p[i] - q[i]) + Math.abs(p[i + 1] - q[i + 1]) + Math.abs(p[i + 2] - q[i + 2])) / 3
      total += d; if (d > 24) large++
    }
    const count = rows * x.width
    return { size: true, mean: total / count, largeShare: large / count }
  }, [a.toString('base64'), b.toString('base64'), excludeBottom])
}

test('the first launch shows the skeleton, then the live shelf, and stores a poster', async ({ page }) => {
  const release = await holdBundle(page)
  await page.goto('/', { waitUntil: 'commit' })
  await expect(page.locator('html')).toHaveClass(/ihr-boot-skeleton/)
  await expect(page.locator('#boot-poster')).toHaveCount(0)
  release()
  await expect(page.locator('canvas.ihr-bookshelf-scene')).toHaveCount(1, { timeout: 60_000 })
  await expect(page.locator('html')).not.toHaveClass(/ihr-boot-skeleton/, { timeout: 60_000 })
  await settleAndStore(page)
  const stored = await meta(page)
  expect(stored.v).toBe(await page.evaluate(() => window.__ihrBoot.build))
  expect(stored.bytes).toBeLessThan(900_000)
  const image = await page.evaluate(() => localStorage.getItem('ihr-poster-img'))
  expect(image.startsWith('data:image/webp')).toBe(true)
})

test('the repeat launch paints the poster before the bundle runs and swaps it for the live shelf without a visible change', async ({ page }) => {
  await page.goto('/')
  await settleAndStore(page)
  const sinceBook = Date.now()
  await addBookAndGoHome(page)
  // The poster must be the one drawn with the book on the shelf, not the empty one.
  await expect.poll(async () => (await meta(page)).at, { timeout: 150_000 }).toBeGreaterThan(sinceBook)

  await page.addInitScript(() => {
    window.__shift = 0
    new PerformanceObserver(list => { for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__shift += entry.value })
      .observe({ type: 'layout-shift', buffered: true })
  })
  const release = await holdBundle(page)
  await page.reload({ waitUntil: 'commit' })
  const poster = page.locator('#boot-poster')
  await expect(poster).toBeVisible()
  expect(await poster.evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true)
  expect(await poster.getAttribute('aria-hidden')).toBe('true')
  // Nothing of the app has run yet: no canvas and no shelf.
  await expect(page.locator('canvas.ihr-bookshelf-scene')).toHaveCount(0)
  const shot = { type: 'png', clip: await poster.evaluate(img => { const r = img.getBoundingClientRect(); return { x: r.left, y: r.top, width: Math.min(r.width, innerWidth - r.left), height: Math.min(r.height, innerHeight - r.top) } }) }
  const posterShot = await page.screenshot(shot)
  release()
  await expect(page.locator('#boot-poster')).toHaveCount(0, { timeout: 120_000 })
  await page.waitForTimeout(300)
  const liveShot = await page.screenshot(shot)
  if (process.env.BOOT_POSTER_DUMP) { writeFileSync(process.env.BOOT_POSTER_DUMP + '/poster.png', posterShot); writeFileSync(process.env.BOOT_POSTER_DUMP + '/live.png', liveShot) }
  const difference = await pixelDifference(page, posterShot, liveShot)
  expect(difference.size).toBe(true)
  // Same pixels up to WebP quantisation: no flash, no moved edges.
  expect(difference.mean).toBeLessThan(5)
  const cabinet = await pixelDifference(page, posterShot, liveShot, 80)
  expect(cabinet.mean).toBeLessThan(2.5)
  expect(cabinet.largeShare).toBeLessThan(0.005)
  expect(await page.evaluate(() => window.__shift)).toBeLessThan(0.02)
})

test('a poster is never shown after the library, the theme or the viewport changed', async ({ page }) => {
  await page.goto('/')
  await settleAndStore(page)
  const poster = page.locator('#boot-poster')

  // Control: unchanged state shows the poster.
  let release = await holdBundle(page)
  await page.reload({ waitUntil: 'commit' })
  await expect(poster).toBeVisible()
  await page.unroute('**/assets/main-*.js'); release()
  await expect(poster).toHaveCount(0, { timeout: 120_000 })

  // Theme changed behind the poster's back.
  await page.evaluate(() => localStorage.setItem('inhouse-read-theme', document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'))
  release = await holdBundle(page)
  await page.reload({ waitUntil: 'commit' })
  await expect(page.locator('html')).toHaveClass(/ihr-boot-skeleton/)
  await expect(poster).toHaveCount(0)
  await page.unroute('**/assets/main-*.js'); release()
  await expect(page.locator('html')).not.toHaveClass(/ihr-boot-skeleton/, { timeout: 120_000 })
  // The new theme gets its own poster once the shelf settles.
  await expect.poll(async () => (await meta(page)).k, { timeout: 120_000 }).not.toBe(null)

  // Library signature changed (a book added or removed since).
  await expect(poster).toHaveCount(0)
  await page.evaluate(() => localStorage.setItem('ihr-lib-sig', 'changed'))
  release = await holdBundle(page)
  await page.reload({ waitUntil: 'commit' })
  await expect(poster).toHaveCount(0)
  await expect(page.locator('html')).toHaveClass(/ihr-boot-skeleton/)
  await page.unroute('**/assets/main-*.js'); release()
  await expect(page.locator('html')).not.toHaveClass(/ihr-boot-skeleton/, { timeout: 120_000 })
})

test('a poster for another viewport size or app build is ignored', async ({ page }) => {
  await page.goto('/')
  await settleAndStore(page)
  await page.setViewportSize({ width: 360, height: 780 })
  const release = await holdBundle(page)
  await page.reload({ waitUntil: 'commit' })
  await expect(page.locator('#boot-poster')).toHaveCount(0)
  await expect(page.locator('html')).toHaveClass(/ihr-boot-skeleton/)
  release()
  await page.evaluate(() => { const m = JSON.parse(localStorage.getItem('ihr-poster-meta')); m.v = 'old'; localStorage.setItem('ihr-poster-meta', JSON.stringify(m)) })
  await page.reload({ waitUntil: 'commit' })
  await expect(page.locator('canvas.ihr-bookshelf-scene')).toHaveCount(1, { timeout: 60_000 })
  // Initialisation removes a poster of an older build.
  await expect.poll(() => meta(page), { timeout: 30_000 }).not.toMatchObject({ v: 'old' })
})

test('storage that refuses writes keeps the app working without a poster', async ({ page }) => {
  await page.addInitScript(() => {
    const set = Storage.prototype.setItem
    Storage.prototype.setItem = function (key, value) {
      if (String(key).startsWith('ihr-poster')) throw new DOMException('full', 'QuotaExceededError')
      return set.call(this, key, value)
    }
  })
  await page.goto('/')
  await expect(page.locator('canvas.ihr-bookshelf-scene')).toHaveCount(1, { timeout: 60_000 })
  await expect(page.locator('html')).not.toHaveClass(/ihr-boot-skeleton/, { timeout: 60_000 })
  await page.waitForTimeout(3000)
  expect(await meta(page)).toBeNull()
})

test('taps on the poster get feedback and are replayed on the live shelf', async ({ page }) => {
  await page.goto('/')
  await settleAndStore(page)
  const sinceBook = Date.now()
  await addBookAndGoHome(page)
  await expect.poll(async () => (await meta(page)).at, { timeout: 150_000 }).toBeGreaterThan(sinceBook)
  const spine = page.locator('.ihr-spine').first()
  await expect(spine).toBeVisible()
  const box = await spine.boundingBox()
  const release = await holdBundle(page)
  await page.reload({ waitUntil: 'commit' })
  await expect(page.locator('#boot-poster')).toBeVisible()
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await expect(page.locator('#boot-pill')).toBeVisible()
  expect(await page.locator('#boot-pill').getAttribute('role')).toBe('status')
  release()
  await expect(page.locator('.ihr-flyout')).toHaveCount(1, { timeout: 120_000 })
})

test('reduced motion removes the poster without a fade', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  await settleAndStore(page)
  const release = await holdBundle(page)
  await page.reload({ waitUntil: 'commit' })
  await expect(page.locator('#boot-poster')).toBeVisible()
  release()
  await expect(page.locator('#boot-poster')).toHaveCount(0, { timeout: 120_000 })
})
