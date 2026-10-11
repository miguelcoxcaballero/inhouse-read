import './helpers/empty-update-channels.mjs'
import { test, expect } from '@playwright/test'
import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import { driveServer } from './helpers/drive-server.mjs'
import {localBookBytes} from './helpers/offline-shell.mjs'

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

test('Android keeps local bytes while automatically backing up a connected library', async ({ page }) => {
  test.setTimeout(120_000)
  let finishUpload, uploadStarted = false
  const held = new Promise(resolve => { finishUpload = resolve })
  const drive = driveServer({ beforeUpload:async metadata => {
    if (metadata.name === 'tiny.pdf') { uploadStarted = true; await held }
  } })
  await drive.connect(page.context())
  await page.addInitScript(() => Object.defineProperty(navigator, 'userAgent', {
    value:`${navigator.userAgent} InhouseReadApp/1.1.12`, configurable:true
  }))
  await page.setViewportSize({ width:390, height:844 })
  await page.reload()
  await page.locator('#file-picker').setInputFiles(PDF_FIXTURE)
  await expect(page.locator('.pdf-page-canvas')).toBeVisible()
  const original = readFileSync(PDF_FIXTURE)
  await expect.poll(() => uploadStarted).toBe(true)
  await expect.poll(() => localBookBytes(page,'tiny.pdf')).toMatchObject({
    bytes:original.length, sha256:createHash('sha256').update(original).digest('hex'), hasDriveCopy:false
  })
  await page.getByRole('button', { name:'Volver a la estantería' }).click()
  await expectReturnComplete(page)
  const spine = page.locator('.ihr-spine').first()
  await expect(spine).toBeVisible(); await spine.focus(); await page.keyboard.press('Enter')
  await expect(page.locator('.ihr-flyout__cloud-action')).toBeVisible()
  finishUpload()
  await expect(page.locator('.ihr-flyout__cloud-saved')).toHaveAccessibleName('Guardado en Google Drive')
  await expect(page.locator('.ihr-flyout__cloud-action')).toHaveCount(0)
  await expect.poll(() => localBookBytes(page,'tiny.pdf'), { timeout:30_000 }).toMatchObject({
    bytes:original.length, sha256:createHash('sha256').update(original).digest('hex'), hasDriveCopy:true
  })
  await expect(page.locator('#drive-upload-screen')).toBeHidden()
  await expect.poll(() => drive.manifests().some(state => state.books.length === 1), { timeout:30_000 }).toBe(true)
  expect([...drive.files.values()].filter(file => file.name === 'tiny.pdf')).toHaveLength(1)
})

test('el lomo tiene profundidad curva 3D y un libro local se reabre tras recargar', async ({ page }) => {
  // Import, return, reload, reopen and return each render real 3D frames.
  // Both complete open/return cycles run on software GL in CI. Each keeps
  // its own 20/30-second assertion limit; allow their combined work to finish.
  test.setTimeout(120_000)
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
  await expect(page.locator('.ihr-flyout__cloud-action')).toHaveCount(0)
  await expect(page.getByRole('button', { name:'Subir a Google Drive',exact:true })).toHaveCount(0)
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

test('el actualizador común entrega la URL y el hash del canal A al puente Android', async ({ page }) => {
  const manifest = JSON.parse(readFileSync('public/android-update.json', 'utf8'))
  const release = { ...manifest, changelog: 'Aviso mejorado.' }
  const catalog = { schemaVersion: 1, channel: 'A', latest: release, releases: [release] }
  await page.route('https://raw.githubusercontent.com/**/updates/A.json?**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(catalog) }))
  await page.addInitScript(() => {
    localStorage.setItem('inhouse-services-updater:read', JSON.stringify({channel:'A',developmentConsent:1,snooze:{}}));
    window.InhouseNative = { getAppVersion: () => '1.0.4', installInhouseUpdate: (url, sha256) => { window.__capturedUpdate = { url, sha256 } } }
  })
  await page.goto('./?inhouse_app=1')
  await expect(page.locator('#inhouse-services-update')).toBeVisible()
  await expect(page.locator('.isu-versions')).toContainText(manifest.version)
  await page.getByRole('button', { name: 'Update', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.__capturedUpdate ?? null)).toEqual({ url: manifest.apkUrl, sha256: manifest.apkSha256 })
})

test('el actualizador recupera el mismo canal y permite aplazar o cambiar a B', async ({ page }) => {
  const release = { version: '1.1.12', versionCode: 25, apkUrl: 'https://github.com/miguelcoxcaballero/inhouse-read/releases/download/test/app.apk', apkSha256: 'a'.repeat(64), apkSizeBytes: 3500000, changelog: 'Descarga mejorada.' }
  const catalog = { schemaVersion: 1, channel: 'A', latest: release, releases: [release] }
  await page.addInitScript(() => {
    window.InhouseNative = {
      getAppVersion: () => '1.1.11', getAppVersionCode: () => 24,
      getUpdateState: () => localStorage.getItem('test-native-updates') || '{"channel":"A","snooze":{}}',
      saveUpdateState: value => localStorage.setItem('test-native-updates', value),
    }
  })
  await page.route('https://api.github.com/**/updates/A.json?**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ content: Buffer.from(JSON.stringify(catalog)).toString('base64') }) }))
  await page.goto('./?inhouse_app=1')
  await page.locator('#drive-profile-btn').click()
  await expect(page.getByRole('button', { name: 'Actualizaciones', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Actualizaciones', exact: true }).click()
  await expect(page.locator('.isu-overlay')).toHaveCount(0)
  await expect(page.locator('#drive-update-settings .isu-inline')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Version B', exact: true })).toHaveAttribute('aria-pressed','true')
  await page.getByRole('button', { name: 'Version A', exact: true }).click()
  await page.getByRole('button', { name: 'I understand — continue', exact: true }).click()
  await page.getByRole('slider', {name:'Slide to confirm version A',exact:true}).focus();await page.keyboard.press('End');await page.keyboard.press('Tab')
  await expect(page.locator('.isu-versions')).toHaveText('1.1.11 → 1.1.12 A')
  await page.getByRole('button', { name: 'Remind me later', exact: true }).click()
  const deadline = await page.evaluate(() => JSON.parse(localStorage.getItem('test-native-updates')).snooze.A)
  expect(deadline - Date.now()).toBeGreaterThan(13 * 86400000)
  await page.reload()
  await page.locator('#drive-profile-btn').click()
  await expect(page.getByRole('button', { name: 'Actualizaciones', exact: true })).toBeVisible()
  await expect(page.locator('#inhouse-services-update')).toHaveCount(0)
  await page.getByRole('button', { name: 'Actualizaciones', exact: true }).click()
  await page.getByRole('button', { name: 'Version B', exact: true }).click()
  await expect(page.getByText('No releases on version B.')).toBeVisible()
  await page.reload()
  await page.locator('#drive-profile-btn').click()
  await page.getByRole('button', { name: 'Actualizaciones', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Version B', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Version A', exact: true }).click()
  await page.getByRole('button', { name: 'I understand — continue', exact: true }).click()
  await page.getByRole('slider', {name:'Slide to confirm version A',exact:true}).focus();await page.keyboard.press('End');await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Update', exact: true })).toBeVisible()
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('test-native-updates')).snooze.A)).toBe(deadline)
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
