import { test, expect } from '@playwright/test'

const PDF_FIXTURE = 'tests/e2e/fixtures/tiny.pdf'

test.beforeEach(async ({ page }) => {
  // Keep this flow independent of desktop-only File System Access pickers.
  await page.addInitScript(() => {
    try {
      Object.defineProperty(window, 'showDirectoryPicker', { value: undefined, configurable: true })
    } catch { /* API absent in this browser */ }
  })
  await page.goto('/')
})

test('el lomo tiene profundidad curva 3D y un libro local se reabre tras recargar', async ({ page }) => {
  await page.locator('#file-picker').setInputFiles(PDF_FIXTURE)
  await expect(page.locator('.pdf-page-canvas')).toBeVisible()

  const savedBook = await page.waitForFunction(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('inhouse-read')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const books = await new Promise((resolve, reject) => {
      const request = db.transaction('books', 'readonly').objectStore('books').getAll()
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const book = books.find(item => item.name === 'tiny.pdf')
    return book?.content instanceof Blob && book.content.size > 0
      ? { id: book.id, bytes: book.content.size, mimeType: book.content.type }
      : false
  })
  expect(await savedBook.jsonValue()).toMatchObject({ bytes: 445, mimeType: 'application/pdf' })

  await page.getByRole('button', { name: 'Volver a la estantería' }).click()
  const spine = page.locator('.ihr-spine').first()
  await expect(spine).toBeVisible()
  const curvature = await spine.locator('.ihr-spine__body').evaluate(element => {
    const segments = [...element.querySelectorAll('.ihr-spine__segment')]
    return {
      frontClip: getComputedStyle(element).clipPath,
      preserve3d: getComputedStyle(element).transformStyle,
      depths: segments.map(segment => Number.parseFloat(
        getComputedStyle(segment).getPropertyValue('--ihr-curve-z')
      )),
      angles: segments.map(segment => Number.parseFloat(
        getComputedStyle(segment).getPropertyValue('--ihr-curve-angle')
      ))
    }
  })
  expect(curvature.frontClip).toBe('none')
  expect(curvature.preserve3d).toBe('preserve-3d')
  expect(curvature.depths).toHaveLength(21)
  expect(curvature.depths[0]).toBeGreaterThan(0)
  expect(curvature.depths[10]).toBeGreaterThan(curvature.depths[0])
  expect(curvature.depths[20]).toBeCloseTo(curvature.depths[0], 2)
  expect(curvature.angles[0]).toBeLessThan(0)
  expect(curvature.angles[20]).toBeGreaterThan(0)

  // Reopening must use the stored Blob, not silently fall back to a native picker.
  await page.reload()
  const reopenedSpine = page.locator('.ihr-spine').first()
  await expect(reopenedSpine).toBeVisible()
  let fileChooserOpened = false
  page.on('filechooser', () => { fileChooserOpened = true })
  await reopenedSpine.click()
  const animatedSpine = page.locator('.ihr-flyout__spine')
  await expect(animatedSpine).toBeAttached()
  const curvedFlyout = await animatedSpine.evaluate(element => {
    const ghost = element.querySelector('.ihr-spine--ghost')
    const body = ghost?.querySelector('.ihr-spine__body')
    const surface = body?.querySelector('.ihr-spine__surface')
    const segments = [...(surface?.querySelectorAll('.ihr-spine__segment') ?? [])]
    return {
      noFlatSideFace: !element.classList.contains('ihr-flyout__face'),
      spine3d: getComputedStyle(element).transformStyle,
      ghost3d: getComputedStyle(ghost).transformStyle,
      body3d: getComputedStyle(body).transformStyle,
      surface3d: getComputedStyle(surface).transformStyle,
      perspective: getComputedStyle(body).perspective,
      segmentCount: segments.length,
      centerDepth: Number.parseFloat(getComputedStyle(segments[24]).getPropertyValue('--ihr-curve-z')),
      edgeDepth: Number.parseFloat(getComputedStyle(segments[0]).getPropertyValue('--ihr-curve-z'))
    }
  })
  expect(curvedFlyout).toMatchObject({
    noFlatSideFace: true,
    spine3d: 'preserve-3d',
    ghost3d: 'preserve-3d',
    body3d: 'preserve-3d',
    surface3d: 'preserve-3d',
    perspective: 'none',
    segmentCount: 48
  })
  expect(curvedFlyout.centerDepth).toBeGreaterThan(curvedFlyout.edgeDepth)
  await expect(page.locator('.pdf-page-canvas')).toBeVisible()
  expect(fileChooserOpened).toBe(false)
})

test('el actualizador usa el manifiesto y entrega URL y hash al puente Android', async ({ page }) => {
  await page.addInitScript(() => {
    window.InhouseNative = {
      getAppVersion: () => '1.0.4',
      installAppUpdate: (url, sha256) => { window.__capturedUpdate = { url, sha256 } }
    }
  })
  await page.goto('/?inhouse_app=1')

  const manifest = await page.evaluate(async () => {
    const response = await fetch(`android-update.json?test=${Date.now()}`, { cache: 'no-store' })
    if (!response.ok) throw new Error(`Manifiesto no disponible: ${response.status}`)
    return response.json()
  })
  const gate = page.locator('#android-update-gate')
  await expect(gate).toBeVisible()
  await expect(page.locator('[data-update-message]')).toContainText(manifest.version)
  await page.locator('[data-update-install]').click()
  await expect.poll(() => page.evaluate(() => window.__capturedUpdate ?? null)).toEqual({
    url: manifest.apkUrl,
    sha256: manifest.apkSha256
  })
})
