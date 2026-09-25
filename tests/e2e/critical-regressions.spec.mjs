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

test('el lomo muestra un arco visible y un libro local se reabre tras recargar', async ({ page }) => {
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
  const clipPath = await spine.locator('.ihr-spine__body').evaluate(element => getComputedStyle(element).clipPath)
  expect(clipPath).toContain('polygon(10% 0%')
  expect(clipPath).toContain('0% 50%')

  // Reopening must use the stored Blob, not silently fall back to a native picker.
  await page.reload()
  const reopenedSpine = page.locator('.ihr-spine').first()
  await expect(reopenedSpine).toBeVisible()
  let fileChooserOpened = false
  page.on('filechooser', () => { fileChooserOpened = true })
  await reopenedSpine.click()
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
