import { test, expect } from '@playwright/test'

const PDF_FIXTURE = 'tests/e2e/fixtures/tiny.pdf'

async function expectReturnComplete(page) {
  // A return layer is created asynchronously. Its initial absence is not
  // completion: CI still painted the bookmark phase after 20 seconds.
  await expect(page.locator('body')).toHaveClass(/is-closing-reader/)
  await expect(page.locator('body')).not.toHaveClass(/is-closing-reader/,{timeout:30_000})
}

test.beforeEach(async ({ page }) => {
  // Keep this flow independent of desktop-only File System Access pickers.
  await page.addInitScript(() => {
    try {
      Object.defineProperty(window, 'showDirectoryPicker', { value: undefined, configurable: true })
    } catch { /* API absent in this browser */ }
  })
  await page.goto(process.env.IHR_TEST_URL || '/')
})

test('Android: mantiene una pantalla de carga hasta que Drive guarda el libro y lo muestra en la estantería', async ({ page }) => {
  test.setTimeout(60_000)
  await page.setViewportSize({ width:390, height:844 })
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'userAgent', {
      value: `${navigator.userAgent} InhouseReadApp/1.0.17`, configurable: true
    })
    localStorage.setItem('ihr_drive_session_v2', JSON.stringify({
      accessToken:'test-drive-token', expiresAt:Date.now() + 3600_000
    }))
  })
  // This test exercises Drive upload, not the public release feed. A newly
  // published APK must not put an unrelated upgrade modal over this fixture.
  await page.route('**/android-update.json?**', route => route.fulfill({
    status:200, contentType:'application/json', body:JSON.stringify({
      version:'1.0.17', required:false, apkUrl:'https://github.com/miguelcoxcaballero/inhouse-read/releases/download/test/app.apk'
    })
  }))
  await page.route('https://api.github.com/repos/miguelcoxcaballero/inhouse-read/releases/latest',
    route => route.fulfill({status:404,body:'No update in this fixture'}))
  let finishBookUpload
  let startedBookUpload
  const bookUploadStarted = new Promise(resolve => { startedBookUpload = resolve })
  const holdBookUpload = new Promise(resolve => { finishBookUpload = resolve })
  let uploadCount = 0

  await page.route('https://www.googleapis.com/drive/v3/about?**', route => route.fulfill({
    status:200, contentType:'application/json',
    body:JSON.stringify({ user:{ permissionId:'account-1', displayName:'Miguel', emailAddress:'miguel@example.com' } })
  }))
  await page.route('https://www.googleapis.com/drive/v3/files**', async route => {
    if (route.request().method() === 'GET') {
      return route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ files:[] }) })
    }
    const body = JSON.parse(route.request().postData() || '{}')
    return route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({
      id:body.name === '.inhouse-read-state' ? 'state-folder' : 'read-folder', name:body.name
    }) })
  })
  await page.route('https://www.googleapis.com/upload/drive/v3/files?**', async route => {
    uploadCount += 1
    if (uploadCount === 1) {
      startedBookUpload()
      await holdBookUpload
      return route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({
        id:'drive-book', name:'tiny.pdf', mimeType:'application/pdf', size:'445'
      }) })
    }
    return route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({
      id:'drive-progress', name:'progress-drive-book.json', mimeType:'application/json', size:'100'
    }) })
  })

  await page.reload()
  await page.locator('#file-picker').setInputFiles(PDF_FIXTURE)
  await bookUploadStarted
  const uploadScreen = page.locator('#drive-upload-screen')
  await expect(uploadScreen).toBeVisible()
  await expect(uploadScreen).toHaveAttribute('aria-busy', 'true')
  await expect(page.locator('#drive-upload-book')).toHaveText('Tiny')

  finishBookUpload()
  await expect(uploadScreen).toBeHidden()
  await page.waitForFunction(async () => {
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
    return books.some(book => book.name === 'tiny.pdf' && book.driveFileId === 'drive-book')
  })
  await page.getByRole('button', { name:'Volver a la estantería' }).click()
  await expectReturnComplete(page)
  await expect(page.getByRole('button', { name:/Abrir tiny/i })).toBeVisible()
})

test('el lomo tiene profundidad curva 3D y un libro local se reabre tras recargar', async ({ page }) => {
  // Import, return, reload, reopen and return each render real 3D frames.
  // Give the complete sequence enough time on the software renderer in CI.
  test.setTimeout(90_000)
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
  await expectReturnComplete(page)
  const spine = page.locator('.ihr-spine').first()
  await expect(spine).toBeVisible()
  const shelfCanvas = page.locator('.ihr-bookshelf-scene')
  await expect(shelfCanvas).toBeVisible()
  await expect(shelfCanvas).toHaveCount(1)
  await expect.poll(() => shelfCanvas.getAttribute('data-active-books')).toBe('1')
  const paintedPixels = await shelfCanvas.evaluate(canvas => {
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
    return pixels.filter((value, i) => i % 4 === 3 && value > 200).length
  })
  expect(paintedPixels).toBeGreaterThan(1000)
  await expect(spine.locator('.ihr-spine__segment')).toHaveCount(0)

  // Start mid-book so the ribbon is present in both the shelf and the lifted
  // 3D model, then verify it lands over the restored page during the opening.
  await page.evaluate(async () => {
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
    book.progressFraction = .42
    await new Promise((resolve, reject) => {
      const tx = db.transaction('books', 'readwrite')
      tx.objectStore('books').put(book)
      tx.oncomplete = resolve
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  })

  // Reopening must use the stored Blob, not silently fall back to a native picker.
  await page.reload()
  const reopenedSpine = page.locator('.ihr-spine').first()
  await expect(reopenedSpine).toBeVisible()
  await reopenedSpine.evaluate(element => element.scrollIntoView({ block:'center' }))
  await expect.poll(() => reopenedSpine.evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThan(0)
  await expect(reopenedSpine).toHaveClass(/has-bookmark/)
  let fileChooserOpened = false
  page.on('filechooser', () => { fileChooserOpened = true })
  await reopenedSpine.click()
  const animatedCanvas = page.locator('.ihr-flyout__book--webgl canvas')
  await expect(animatedCanvas).toBeVisible()
  await expect(animatedCanvas).toHaveAttribute('data-bookmark3d', 'true')
  await expect(animatedCanvas).toHaveAttribute('data-angle', '0')
  await expect.poll(() => animatedCanvas.evaluate(canvas => {
    const ratio = canvas.width / window.innerWidth
    if (!ratio) return 0
    const pixels = canvas.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height).data
    if (!pixels) return 0
    for (let i=3; i<pixels.length; i+=4) if (pixels[i] > 200) return 1
    return 0
  })).toBeGreaterThan(0)
  const silhouette = await animatedCanvas.evaluate(canvas => {
    const ratio = canvas.width / window.innerWidth
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
    let left = canvas.width
    for (let y=0; y<canvas.height; y++) for (let x=0; x<canvas.width; x++) {
      if (pixels[(y * canvas.width + x) * 4 + 3] > 200) left = Math.min(left, x)
    }
    const cover = document.querySelector('.ihr-flyout__cover-target').getBoundingClientRect()
    return { bulge: cover.left - left / ratio }
  })
  // Actual rendered pixels must extend past the front cover, not a DOM box.
  expect(silhouette.bulge).toBeGreaterThan(8)
  expect(silhouette.bulge).toBeLessThan(40)
  await expect(page.locator('.pdf-page-canvas')).toBeAttached()
  await expect(page.locator('#reader-screen')).toHaveClass(/is-preparing/)
  await expect(page.locator('.reader-toolbar')).toBeHidden()
  await expect(page.getByRole('button', { name: 'Guardar en Drive' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Toca para leer/ })).toBeVisible()
  await page.getByRole('button', { name: /Toca para leer/ }).click()
  await expect(page.locator('#reader-screen')).toHaveClass(/is-opening-from-book/)
  await expect(page.locator('.ihr-flyout__book canvas')).toHaveAttribute('data-page-source', 'pdf-canvas')
  await expect(page.locator('.ihr-flyout__book canvas')).toHaveAttribute('data-bookmark3d', 'true')
  await expect(page.locator('.ihr-reader-page-ribbon')).toHaveCount(0)
  await expect(page.locator('.ihr-flyout')).toHaveCount(0,{timeout:20_000})
  await expect(page.locator('.pdf-page-canvas')).toBeVisible()
  await expect(page.locator('.reader-toolbar')).toBeVisible()
  await expect(page.locator('#reader-screen')).not.toHaveClass(/is-opening-from-book/)
  await expect(page.locator('.ihr-reader-page-ribbon')).toHaveCount(0)
  expect(fileChooserOpened).toBe(false)

  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.evaluate(() => {
    window.__firstReturnHandoffFrame = new Promise(resolve => {
      document.querySelector('#reader-back').addEventListener('click', () => {
        requestAnimationFrame(() => {
          const painted = node => node && !node.hidden && node.getBoundingClientRect().width > 0 &&
            getComputedStyle(node).visibility !== 'hidden';
          resolve({ readerPageVisible:Boolean(painted(document.querySelector('#reader-screen'))),
            returnPageVisible:Boolean(painted(document.querySelector('.ihr-reader-return-page'))),
            returnModelVisible:Boolean(painted(document.querySelector('.ihr-flyout--return'))) });
        })
      }, { once: true })
    })
  })
  await page.getByRole('button', { name:'Volver a la estantería' }).click()
  const firstReturnFrame = await page.evaluate(() => window.__firstReturnHandoffFrame)
  // The reader now hands its current page to an OPEN book before that book
  // closes. Every first frame must retain a painted page throughout capture.
  expect(Object.values(firstReturnFrame).some(Boolean)).toBe(true)
  await expectReturnComplete(page)
  const returnFlight = page.locator('.ihr-flyout--return')
  await expect(returnFlight).toHaveCount(0, { timeout:20_000 })
  await expect(page.locator('.ihr-spine').first()).not.toHaveClass(/is-away/)
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

test('si Pages conserva el manifiesto viejo, ofrece la APK nueva desde GitHub Releases', async ({ page }) => {
  const sha = 'a'.repeat(64)
  const apkUrl = 'https://github.com/miguelcoxcaballero/inhouse-read/releases/download/android-v1.0.12/inhouse-read-release-v1.0.12.apk'
  await page.addInitScript(() => {
    window.InhouseNative = {
      getAppVersion: () => '1.0.8',
      installAppUpdate: (url, digest) => { window.__capturedUpdate = { url, digest } }
    }
  })
  await page.route('**/android-update.json?**', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ version: '1.0.8', apkUrl: 'https://github.com/miguelcoxcaballero/inhouse-read/releases/download/android-v1.0.8/inhouse-read-release-v1.0.8.apk' })
  }))
  await page.route('https://api.github.com/repos/miguelcoxcaballero/inhouse-read/releases/latest', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ tag_name: 'android-v1.0.12', assets: [{
      name: 'inhouse-read-release-v1.0.12.apk', browser_download_url: apkUrl,
      digest: `sha256:${sha}`, size: 3500000
    }] })
  }))
  await page.goto('/?inhouse_app=1')
  await expect(page.locator('#android-update-gate')).toBeVisible()
  await expect(page.locator('[data-update-message]')).toContainText('1.0.12')
  await page.locator('[data-update-install]').click()
  await expect.poll(() => page.evaluate(() => window.__capturedUpdate)).toEqual({ url: apkUrl, digest: sha })
})


test('móvil: el modelo se dibuja, se cancela durante el giro y vuelve a abrir', async ({ page }) => {
  // CI spent 20–23 seconds returning the imported book before the two opens.
  // Give this complete sequence its own budget, then assert each final state.
  test.setTimeout(90_000)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.locator('#file-picker').setInputFiles(PDF_FIXTURE)
  await expect(page.locator('.pdf-page-canvas')).toBeVisible()
  await page.getByRole('button', { name: 'Volver a la estantería' }).click()
  await expectReturnComplete(page)
  await expect(page.locator('.ihr-flyout--return')).toHaveCount(0)
  const spine = page.locator('.ihr-spine').first()
  await spine.click()
  await expect(page.locator('.ihr-flyout__book--webgl canvas')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('.ihr-flyout')).toHaveCount(0)
  await expect(spine).toBeVisible()
  await spine.click()
  await expect(page.locator('.ihr-flyout__book--webgl canvas')).toHaveAttribute('data-angle', '0')
  await expect(page.locator('.pdf-page-canvas')).toBeAttached()
  await expect(page.locator('#reader-screen')).toHaveClass(/is-preparing/)
  await page.getByRole('button', { name: /Toca para leer/ }).click()
  await expect(page.locator('.ihr-flyout')).toHaveCount(0)
  await expect(page.locator('.pdf-page-canvas')).toBeVisible()
})

test('sin WebGL se mantiene la apertura del libro con una portada de reserva', async ({ page }) => {
  test.setTimeout(60_000)
  await page.addInitScript(() => {
    Object.defineProperty(window, 'WebGLRenderingContext', { value: undefined })
    Object.defineProperty(window, 'WebGL2RenderingContext', { value: undefined })
  })
  await page.reload()
  await page.locator('#file-picker').setInputFiles(PDF_FIXTURE)
  await expect(page.locator('.pdf-page-canvas')).toBeVisible()
  await page.getByRole('button', { name: 'Volver a la estantería' }).click()
  await expectReturnComplete(page)
  await expect(page.locator('.ihr-flyout--return')).toHaveCount(0)
  await page.locator('.ihr-spine').first().click()
  await expect(page.locator('.ihr-flyout__book--fallback')).toBeVisible()
  await expect(page.locator('.pdf-page-canvas')).toBeAttached()
  await expect(page.locator('#reader-screen')).toHaveClass(/is-preparing/)
  await expect(page.locator('#reader-screen')).toBeHidden()
  await page.getByRole('button', { name: /Toca para leer/ }).click()
  await expect(page.locator('.pdf-page-canvas')).toBeVisible()
})
