import { test, expect } from '@playwright/test'

// The page drawn on the 3D book while it opens and closes is a canvas that
// re-paints the laid out text of the reader. It must look like the reader does
// with the user's settings: a justified page has to be flush on the right, not
// ragged. These tests close a real book, catch the page the app hands to the 3D
// book (the still copy that stays on screen until the 3D leaf is drawn) and
// compare it with a screenshot of the live page, line by line.

test.use({ viewport:{ width:390, height:844 }, hasTouch:true, isMobile:true, deviceScaleFactor:1 })

const PREFERENCES_KEY = 'inhouse-read-reading-preferences'
const EPUB = 'tests/e2e/fixtures/justified-prose.epub'
const EDGE_TOLERANCE = 1.5 // px, right and left edge of every line

async function startWith(page, preferences) {
  await page.emulateMedia({ reducedMotion:'reduce' })
  await page.addInitScript(({ key, preferences }) => {
    localStorage.setItem(key, JSON.stringify(preferences))
    // The still copy of the page the app shows while the book closes.
    new MutationObserver(() => {
      const canvas = document.querySelector('.ihr-reader-return-page canvas')
      if (canvas && !window.__closingPage) window.__closingPage = canvas.toDataURL('image/png')
    }).observe(document, { subtree:true, childList:true })
  }, { key:PREFERENCES_KEY, preferences })
  await page.goto(process.env.IHR_TEST_URL || '/')
  await page.locator('#file-picker').setInputFiles(EPUB)
  await expect.poll(() => page.evaluate(() => Boolean(document.querySelector('foliate-view')?.renderer?.getContents?.()[0]?.doc?.body)), { timeout:60_000 }).toBe(true)
  await expect(page.locator('#reader-toolbar')).toBeVisible()
  // Let fonts, columns and the restored position settle.
  await page.waitForTimeout(1500)
}

/** Live page and closing snapshot, side by side: the right edge of every line of text in each. */
async function compare(page, testInfo, name) {
  const box = await page.locator('foliate-view').boundingBox()
  const live = await page.screenshot({ clip:box })
  await page.getByRole('button', { name:'Volver a la estantería' }).click()
  await expect.poll(() => page.evaluate(() => window.__closingPage || null), { timeout:60_000 }).not.toBeNull()
  const snapshot = await page.evaluate(() => window.__closingPage)
  const result = await page.evaluate(async ({ live, snapshot }) => {
    const grab = async source => {
      const image = new Image(); image.src = source; await image.decode()
      const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight
      const context = canvas.getContext('2d', { willReadFrequently:true }); context.drawImage(image, 0, 0)
      return { canvas, data:context.getImageData(0, 0, canvas.width, canvas.height).data, width:canvas.width, height:canvas.height }
    }
    const a = await grab(live), b = await grab(snapshot)
    const width = Math.min(a.width, b.width), height = Math.min(a.height, b.height)
    const ink = (picture, x, y) => {
      const i = (y * picture.width + x) * 4, d = picture.data
      return Math.max(Math.abs(d[i] - picture.data[0]), Math.abs(d[i + 1] - picture.data[1]), Math.abs(d[i + 2] - picture.data[2])) > 70
    }
    const lines = []
    let from = -1
    for (let y = 0; y <= height; y++) {
      let any = false
      if (y < height) for (let x = 0; x < width && !any; x++) any = ink(a, x, y)
      if (any && from < 0) from = y
      if (!any && from >= 0) {
        if (y - from >= 4) {
          const edges = picture => {
            let left = Infinity, right = -1
            for (let yy = from; yy < y; yy++) for (let x = 0; x < width; x++) if (ink(picture, x, yy)) { if (x < left) left = x; if (x > right) right = x }
            return { left, right }
          }
          lines.push({ top:from, live:edges(a), snapshot:edges(b) })
        }
        from = -1
      }
    }
    return { lines, size:{ live:[a.width, a.height], snapshot:[b.width, b.height] } }
  }, { live:`data:image/png;base64,${live.toString('base64')}`, snapshot })
  await testInfo.attach(`${name}-live`, { body:live, contentType:'image/png' })
  await testInfo.attach(`${name}-snapshot`, { body:Buffer.from(snapshot.split(',')[1], 'base64'), contentType:'image/png' })
  expect(result.size.snapshot).toEqual(result.size.live)
  return result.lines
}

const worst = (lines, side) => Math.max(...lines.map(line => Math.abs(line.live[side] - line.snapshot[side])))

for (const theme of ['paper', 'night']) {
  test(`${theme}: a justified page is drawn flush on the right like the reader shows it`, async ({ page }, testInfo) => {
    test.setTimeout(240_000)
    await startWith(page, { theme, align:'justify' })
    const lines = await compare(page, testInfo, `justify-${theme}`)
    expect(lines.length).toBeGreaterThan(12)
    // Most lines of a justified paragraph end on the same right edge in the live page...
    const margin = Math.max(...lines.map(line => line.live.right))
    const flush = lines.filter(line => line.live.right >= margin - 1.5)
    expect(flush.length).toBeGreaterThan(8)
    // ...and the snapshot must put each of them on that edge too (the old one fell 20-90 px short).
    for (const line of flush) expect(Math.abs(line.live.right - line.snapshot.right), `line at ${line.top}`).toBeLessThanOrEqual(EDGE_TOLERANCE)
    expect(worst(lines, 'right')).toBeLessThanOrEqual(EDGE_TOLERANCE)
    expect(worst(lines, 'left')).toBeLessThanOrEqual(EDGE_TOLERANCE)
  })
}

test('left aligned text stays ragged exactly where the reader breaks its lines', async ({ page }, testInfo) => {
  test.setTimeout(240_000)
  await startWith(page, { align:'start', font:'classic', fontSize:22 })
  const lines = await compare(page, testInfo, 'start-classic')
  expect(lines.length).toBeGreaterThan(10)
  const rights = lines.map(line => line.live.right)
  expect(Math.max(...rights) - Math.min(...rights)).toBeGreaterThan(8) // really ragged, so the check is not vacuous
  expect(worst(lines, 'right')).toBeLessThanOrEqual(EDGE_TOLERANCE)
  expect(worst(lines, 'left')).toBeLessThanOrEqual(EDGE_TOLERANCE)
})
