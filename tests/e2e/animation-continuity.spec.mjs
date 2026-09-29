import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'

async function seedCoveredBooks(page) {
  const content = [...await readFile('tests/e2e/fixtures/reading-journey.pdf')]
  const shortContent = [...await readFile('tests/e2e/fixtures/tiny.pdf')]
  await page.evaluate(async ({ bytes, shortBytes }) => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('inhouse-read')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const records = await Promise.all(Array.from({ length:8 }, async (_, index) => {
      const image = document.createElement('canvas')
      image.width = 900; image.height = 1350
      const context = image.getContext('2d')
      // Two separate ink regions distinguish the real jacket from the green
      // generated fallback, even under the model's physically based lighting.
      context.fillStyle = '#bd2739'; context.fillRect(0, 0, 900, 675)
      context.fillStyle = '#2350b5'; context.fillRect(0, 675, 900, 675)
      context.fillStyle = '#fffaf0'; context.font = 'bold 82px Georgia'
      context.fillText(`Biblioteca ${index + 1}`, 70, 190)
      context.font = '42px Georgia'; context.fillText('Una portada impresa', 70, 1160)
      context.strokeStyle = '#e8d3a1'; context.lineWidth = 9
      context.strokeRect(38 + index * 2, 38, 824 - index * 4, 1274)
      const cover = await new Promise(resolve => image.toBlob(resolve, 'image/jpeg', .92))
      const id = `continuity:${index}`, title = `Biblioteca ${index + 1}`
      return {
        id, title, author:'Autora de prueba', name:`biblioteca-${index}.pdf`,
        sourceType:'local', format:'PDF', mimeType:'application/pdf',
        content:new Blob([new Uint8Array(index === 0 ? shortBytes : bytes)], { type:'application/pdf' }),
        cover, coverAppearance:{ color:'#446548', shade:'#2a422c', ink:'#fffaf0',
          aspectRatio:2 / 3, fontFamily:'Lora', fontCanvasFamily:'Lora', source:'cover' },
        coverAppearanceKey:`${id}|${title}|${cover.type}|${cover.size}|`,
        spineColorOverride:'#446548', pageCount:index === 0 ? 1 : 4, shelfOrder:index,
        addedAt:Date.now(), lastOpenedAt:Date.now() - index, progressFraction:.25
      }
    }))
    const transaction = db.transaction('books', 'readwrite')
    for (const record of records) transaction.objectStore('books').put(record)
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve
      transaction.onerror = () => reject(transaction.error)
    })
    db.close()
  }, { bytes:content, shortBytes:shortContent })
  await page.reload()
  await expect(page.locator('.ihr-spine')).toHaveCount(8)
}

async function observePrintedCoverFrames(page) {
  await page.evaluate(() => {
    const sample = document.createElement('canvas')
    sample.width = 160; sample.height = 346
    const context = sample.getContext('2d', { willReadFrequently:true })
    const seen = new WeakMap()
    window.__printedCoverFrames = { count:0, failures:[], firstFailureImage:null }
    const sampleFrame = canvas => {
      const flyout = canvas.closest('.ihr-flyout')
      if (!flyout || flyout.classList.contains('is-opening-book')) return
      const angle = Number(canvas.dataset.angle)
      if (!Number.isFinite(angle) || Math.abs(angle) > 35) return
      context.clearRect(0, 0, sample.width, sample.height)
      context.drawImage(canvas, 0, 0, sample.width, sample.height)
      const pixels = context.getImageData(0, 0, sample.width, sample.height).data
      let red = 0, blue = 0, opaque = 0, hash = 0
      for (let index = 0; index < pixels.length; index += 4) {
        const [r, g, b, alpha] = pixels.subarray(index, index + 4)
        hash = (hash * 31 + r + g + b) | 0
        if (alpha < 200) continue
        opaque++
        if (r > g * 1.45 && r > b * 1.35) red++
        if (b > r * 1.45 && b > g * 1.2) blue++
      }
      if (seen.get(canvas) === hash) return
      seen.set(canvas, hash)
      const samples = window.__printedCoverFrames
      samples.count++
      if (red < 8 || blue < 8) {
        samples.failures.push({ angle, red, blue, opaque, returning:flyout.classList.contains('ihr-flyout--return') })
        samples.firstFailureImage ||= sample.toDataURL('image/png')
      }
    }
    window.__printedCoverObserver = new MutationObserver(() => {
      for (const canvas of document.querySelectorAll('.ihr-flyout__book canvas')) sampleFrame(canvas)
    })
    window.__printedCoverObserver.observe(document.body, {
      subtree:true, childList:true, attributes:true, attributeFilter:['data-angle']
    })
    window.__originalShelfCanvas = document.querySelector('.ihr-bookshelf-scene')
  })
}

test('varias portadas reales salen y regresan sin mostrar portadas provisionales ni reconstruir la estantería', async ({ page }) => {
  test.setTimeout(90_000)
  await page.setViewportSize({ width:390, height:844 })
  await page.emulateMedia({ reducedMotion:'no-preference' })
  await page.addInitScript(() => {
    localStorage.setItem('inhouse-read-theme', 'dark')
    const source = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src')
    const decode = HTMLImageElement.prototype.decode
    const pending = new WeakMap()
    Object.defineProperty(HTMLImageElement.prototype, 'src', {
      ...source,
      set(value) {
        if (typeof value !== 'string' || !value.startsWith('blob:')) return source.set.call(this, value)
        const ready = new Promise(resolve => setTimeout(() => {
          source.set.call(this, value)
          resolve()
        }, 900))
        pending.set(this, ready)
      }
    })
    HTMLImageElement.prototype.decode = function () {
      return Promise.resolve(pending.get(this)).then(() => decode.call(this))
    }
  })
  await page.goto(process.env.IHR_TEST_URL || '/')
  await seedCoveredBooks(page)
  // The original shelf has already decoded its images. Any newly generated
  // jacket during a selection is an avoidable duplicate decode, as on a slow phone.
  await page.waitForTimeout(1150)
  await page.getByRole('button', { name:'Vista isométrica, libros de lado' }).click()
  await expect(page.locator('.ihr-bookshelf-scene')).toHaveAttribute('data-view-progress', '1')
  await expect(page.locator('.ihr-bookshelf-scene')).toHaveAttribute('data-animating', 'false')
  await observePrintedCoverFrames(page)
  // Cancel in the image-metadata phase, before the lifted view exists.
  const pendingSpine = page.locator('.ihr-spine[data-book-id="continuity:0"]')
  const pendingBounds = await pendingSpine.boundingBox()
  await pendingSpine.click({ position:{ x:Math.min(8, pendingBounds.width * .12), y:pendingBounds.height * .65 } })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(1150)
  await expect(page.locator('.ihr-flyout')).toHaveCount(0)

  for (const index of [0, 1, 2]) {
    const spine = page.locator(`.ihr-spine[data-book-id="continuity:${index}"]`)
    const bounds = await spine.boundingBox()
    // Touch the visible binding at the left of the projected box. Its center
    // includes the book's depth and may be occupied by the next real mesh.
    await spine.click({ position:{ x:Math.min(8, bounds.width * .12), y:bounds.height * .65 } })
    await expect(page.locator('.ihr-flyout__cover-target')).toBeVisible()
    await page.getByRole('button', { name:'Cerrar', exact:true }).click()
    await expect(page.locator('.ihr-flyout')).toHaveCount(0)
    await expect(spine).not.toHaveClass(/is-away/)
    if (index === 0) {
      // Mobile viewport changes must retarget the already textured scene.
      // Rebuilding it would briefly replace every real jacket with generated art.
      await page.setViewportSize({ width:414, height:844 })
      await expect(page.locator('.ihr-bookshelf-scene')).toHaveAttribute('data-animating', 'false')
    }
  }

  // Cancel while the book is still leaving its slot, then select another.
  await page.getByRole('button', { name:'Vista de canto', exact:true }).click()
  await expect(page.locator('.ihr-bookshelf-scene')).toHaveAttribute('data-view-progress', '0')
  await expect(page.locator('.ihr-bookshelf-scene')).toHaveAttribute('data-animating', 'false')
  await page.locator('.ihr-spine[data-book-id="continuity:0"]').click()
  await expect(page.locator('.ihr-flyout')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('.ihr-flyout')).toHaveCount(0)
  await page.locator('.ihr-spine[data-book-id="continuity:1"]').click()
  await expect(page.locator('.ihr-flyout__cover-target')).toBeVisible()
  await page.getByRole('button', { name:'Cerrar', exact:true }).click()
  await expect(page.locator('.ihr-flyout')).toHaveCount(0)

  const result = await page.evaluate(() => {
    window.__printedCoverObserver.disconnect()
    return { ...window.__printedCoverFrames,
      retainedShelf:window.__originalShelfCanvas === document.querySelector('.ihr-bookshelf-scene') }
  })
  if (result.firstFailureImage) await test.info().attach('unexpected-cover-frame', {
    body:Buffer.from(result.firstFailureImage.split(',')[1], 'base64'), contentType:'image/png'
  })
  expect(result.count).toBeGreaterThan(12)
  expect(result.failures).toEqual([])
  expect(result.retainedShelf).toBe(true)
  await page.screenshot({ path:'test-results/covered-shelf-after-repeated-open-close.png' })
})

test('seleccionar otro libro y volver al primero abre su documento y conserva la portada al regresar', async ({ page }) => {
  test.setTimeout(60_000)
  await page.setViewportSize({ width:390, height:844 })
  await page.emulateMedia({ reducedMotion:'no-preference' })
  await page.goto(process.env.IHR_TEST_URL || '/')
  await seedCoveredBooks(page)
  for (const index of [0, 1]) {
    await page.locator(`.ihr-spine[data-book-id="continuity:${index}"]`).click()
    await expect(page.locator('.ihr-flyout__readiness')).toHaveText('Listo para leer')
    await page.getByRole('button', { name:'Cerrar', exact:true }).click()
    await expect(page.locator('.ihr-flyout')).toHaveCount(0)
  }
  await page.locator('.ihr-spine[data-book-id="continuity:0"]').click()
  await page.locator('.ihr-flyout__cover-target').click()
  await expect(page.locator('.pdf-page-canvas')).toBeVisible()
  // The first PDF has one page; the second has four. A resolved preparation
  // promise for A must never reveal B from the single shared reader instance.
  await expect(page.locator('#reader-location')).toHaveText('Página 1 de 1')
  await observePrintedCoverFrames(page)
  await page.getByRole('button', { name:'Volver a la estantería' }).click()
  await expect(page.locator('.ihr-flyout')).toHaveCount(0)
  const frames = await page.evaluate(() => {
    window.__printedCoverObserver.disconnect()
    return window.__printedCoverFrames
  })
  expect(frames.count).toBeGreaterThan(1)
  expect(frames.failures).toEqual([])
})
