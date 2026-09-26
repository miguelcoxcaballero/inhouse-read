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
  const shelfCanvas = spine.locator('canvas[data-renderer="three-mesh"]')
  await expect(shelfCanvas).toBeVisible()
  const paintedPixels = await shelfCanvas.evaluate(canvas => {
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
    return pixels.filter((value, i) => i % 4 === 3 && value > 200).length
  })
  expect(paintedPixels).toBeGreaterThan(1000)
  await expect(spine.locator('.ihr-spine__segment')).toHaveCount(0)

  // Reopening must use the stored Blob, not silently fall back to a native picker.
  await page.reload()
  const reopenedSpine = page.locator('.ihr-spine').first()
  await expect(reopenedSpine).toBeVisible()
  const spineSize = await reopenedSpine.evaluate(element => ({ width: element.offsetWidth, height: element.offsetHeight }))
  let fileChooserOpened = false
  page.on('filechooser', () => { fileChooserOpened = true })
  await reopenedSpine.click()
  const animatedCanvas = page.locator('.ihr-flyout__book--webgl canvas')
  await expect(animatedCanvas).toBeVisible()
  await expect(animatedCanvas).toHaveAttribute('data-angle', '0')
  const silhouette = await animatedCanvas.evaluate((canvas, spineSize) => {
    const ratio = canvas.width / window.innerWidth
    const y = Math.floor(window.innerHeight * .44 * ratio)
    const pixels = canvas.getContext('2d').getImageData(0, y, canvas.width, 1).data
    let left = canvas.width
    for (let x = 0; x < canvas.width; x++) if (pixels[x * 4 + 3] > 200) { left = x / ratio; break }
    const coverH = Math.min(innerHeight * .54, 440, innerWidth * .78 / .66,
      innerWidth * .86 / (.66 + spineSize.width / spineSize.height * .55))
    const thickness = spineSize.width * coverH / spineSize.height
    const coverLeft = innerWidth / 2 + thickness * .19 - coverH * .66 / 2
    return { bulge: coverLeft - left }
  }, spineSize)
  // Actual rendered pixels must extend past the front cover, not a DOM box.
  expect(silhouette.bulge).toBeGreaterThan(8)
  expect(silhouette.bulge).toBeLessThan(40)
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


test('móvil: el modelo se dibuja, se cancela durante el giro y vuelve a abrir', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.locator('#file-picker').setInputFiles(PDF_FIXTURE)
  await expect(page.locator('.pdf-page-canvas')).toBeVisible()
  await page.getByRole('button', { name: 'Volver a la estantería' }).click()
  const spine = page.locator('.ihr-spine').first()
  await spine.click()
  await expect(page.locator('.ihr-flyout__book--webgl canvas')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('.ihr-flyout')).toHaveCount(0)
  await expect(spine).toBeVisible()
  await spine.click()
  await expect(page.locator('.ihr-flyout__book--webgl canvas')).toHaveAttribute('data-angle', '0')
  await expect(page.locator('.pdf-page-canvas')).toBeVisible()
})

test('sin WebGL se mantiene la apertura del libro con una portada de reserva', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'WebGLRenderingContext', { value: undefined })
    Object.defineProperty(window, 'WebGL2RenderingContext', { value: undefined })
  })
  await page.reload()
  await page.locator('#file-picker').setInputFiles(PDF_FIXTURE)
  await expect(page.locator('.pdf-page-canvas')).toBeVisible()
  await page.getByRole('button', { name: 'Volver a la estantería' }).click()
  await page.locator('.ihr-spine').first().click()
  await expect(page.locator('.ihr-flyout__book--fallback')).toBeVisible()
  await expect(page.locator('.pdf-page-canvas')).toBeVisible()
})
