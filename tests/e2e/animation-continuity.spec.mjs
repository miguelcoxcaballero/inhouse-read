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
    const sampledViews = new WeakSet()
    window.__printedCoverFrames = { count:0, views:0, failures:[], firstFailureImage:null }
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
      if (!sampledViews.has(canvas)) { sampledViews.add(canvas); samples.views++ }
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

async function observeShelfInsertion(page, bookId) {
  await page.evaluate(id => {
    const originalCanvas = document.querySelector('.ihr-bookshelf-scene')
    const result = { samples:0, progress:[], failures:[], retainedShelf:true,
      insertionImage:null, usesOverlay:false, overlayAlphaPixels:0 }
    const painted = node => {
      if (!node?.isConnected || !node.getBoundingClientRect().width) return false
      for (let current = node; current instanceof Element; current = current.parentElement) {
        const style = getComputedStyle(current)
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false
      }
      return true
    }
    let frame
    const sample = () => {
      const canvas = document.querySelector('.ihr-bookshelf-scene')
      result.retainedShelf &&= canvas === originalCanvas
      if (canvas?.dataset.returningBookId !== id) return
      result.samples++
      const progress = Number(canvas.dataset.returnProgress)
      if (!result.progress.includes(progress)) result.progress.push(progress)
      const spine = document.querySelector(`.ihr-spine[data-book-id="${id}"]`)
      const overlays = [...document.querySelectorAll('.ihr-flyout__book canvas')].filter(painted)
      const renderer = canvas.dataset.returnRenderer
      result.usesOverlay ||= renderer === 'shared-depth-overlay'
      // A full-screen output is allowed for books protruding past the cabinet
      // bounds, but only when masked by the same furniture depth buffer. A
      // separately lit flyout would paint over its neighboring book meshes.
      if (overlays.length > 1 || (overlays.length && renderer !== 'shared-depth-overlay') ||
          overlays.some(overlay => overlay.dataset.insertionDepth !== 'shared-shelf' ||
            Number(overlay.dataset.returnProgress) !== progress) ||
          !spine?.classList.contains('is-away')) result.failures.push({
        progress, renderer, visibleOverlays:overlays.length,
        overlayDepth:overlays.map(overlay => overlay.dataset.insertionDepth),
        originalHidden:spine?.classList.contains('is-away') || false
      })
      if (!result.insertionImage && progress > .15 && progress < .85) {
        const image = document.createElement('canvas')
        image.width = innerWidth; image.height = innerHeight
        const context = image.getContext('2d')
        context.fillStyle = '#141614'; context.fillRect(0, 0, image.width, image.height)
        const paint = source => {
          const bounds = source.getBoundingClientRect()
          context.drawImage(source, bounds.left, bounds.top, bounds.width, bounds.height)
        }
        const clip = document.querySelector('.ihr-bookshelf__scroll').getBoundingClientRect()
        context.save(); context.beginPath(); context.rect(clip.left, clip.top, clip.width, clip.height); context.clip()
        paint(canvas); context.restore()
        for (const overlay of overlays) paint(overlay)
        result.insertionImage = image.toDataURL('image/png')
        const sample = document.createElement('canvas')
        sample.width = 80; sample.height = 172
        const sampleContext = sample.getContext('2d', { willReadFrequently:true })
        for (const overlay of overlays) sampleContext.drawImage(overlay, 0, 0, sample.width, sample.height)
        const pixels = sampleContext.getImageData(0, 0, sample.width, sample.height).data
        for (let index = 3; index < pixels.length; index += 4) if (pixels[index] > 0) result.overlayAlphaPixels++
      }
    }
    const observer = new MutationObserver(sample)
    observer.observe(document.body, { subtree:true, childList:true, attributes:true,
      attributeFilter:['data-returning-book-id', 'data-return-progress', 'data-return-renderer', 'class', 'style'] })
    const tick = () => { sample(); frame = requestAnimationFrame(tick) }
    frame = requestAnimationFrame(tick)
    window.__finishShelfInsertion = () => {
      sample(); observer.disconnect(); cancelAnimationFrame(frame)
      return result
    }
  }, bookId)
}

async function expectDepthTestedInsertion(page, trigger, bookId = 'continuity:2') {
  await observeShelfInsertion(page, bookId)
  await trigger()
  await expect(page.locator('.ihr-flyout')).toHaveCount(0)
  await expect(page.locator(`.ihr-spine[data-book-id="${bookId}"]`)).not.toHaveClass(/is-away/)
  const result = await page.evaluate(() => window.__finishShelfInsertion())
  if (result.insertionImage) await test.info().attach(`book-insertion-${bookId}`, {
    body:Buffer.from(result.insertionImage.split(',')[1], 'base64'), contentType:'image/png'
  })
  expect(result.retainedShelf).toBe(true)
  expect(result.samples).toBeGreaterThan(0)
  expect(result.progress.some(progress => progress > 0 && progress < 1)).toBe(true)
  expect(result.progress.at(-1)).toBeGreaterThan(result.progress[0])
  expect(result.failures).toEqual([])
  if (result.usesOverlay) expect(result.overlayAlphaPixels).toBeGreaterThan(0)
  await expect(page.locator('.ihr-bookshelf-scene')).not.toHaveAttribute('data-returning-book-id', bookId)
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
  // Every selected cover is checked, independent of the runner's GPU speed.
  expect(result.views).toBeGreaterThanOrEqual(4)
  expect(result.count).toBeGreaterThanOrEqual(result.views)
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

test('el libro vuelve entre sus vecinos con profundidad real en vistas frontal e isométrica y desde el lector', async ({ page }) => {
  test.setTimeout(90_000)
  await page.setViewportSize({ width:390, height:844 })
  await page.emulateMedia({ reducedMotion:'no-preference' })
  await page.goto(process.env.IHR_TEST_URL || '/')
  await seedCoveredBooks(page)
  const selectBook = async (index = 2) => {
    const book = page.locator(`.ihr-spine[data-book-id="continuity:${index}"]`)
    const bounds = await book.boundingBox()
    await book.click({ position:{ x:Math.min(8, bounds.width * .12), y:bounds.height * .65 } })
    await expect(page.locator('.ihr-flyout__cover-target')).toBeVisible()
  }

  for (const mode of ['frontal', 'isometric']) {
    if (mode === 'isometric') {
      await page.getByRole('button', { name:'Vista isométrica, libros de lado' }).click()
      await expect(page.locator('.ihr-bookshelf-scene')).toHaveAttribute('data-view-progress', '1')
      await expect(page.locator('.ihr-bookshelf-scene')).toHaveAttribute('data-animating', 'false')
    }
    await test.step(`${mode}: cerrar la portada`, async () => {
      await selectBook()
      await expectDepthTestedInsertion(page, () => page.getByRole('button', { name:'Cerrar', exact:true }).click())
    })
    await test.step(`${mode}: regresar desde el documento`, async () => {
      await selectBook()
      await page.locator('.ihr-flyout__cover-target').click()
      await expect(page.locator('.pdf-page-canvas')).toBeVisible()
      await expect(page.locator('#reader-location')).toHaveText(/Página \d de 4/)
      await expectDepthTestedInsertion(page, () => page.getByRole('button', { name:'Volver a la estantería' }).click())
    })
  }
  // The isometric drawer can protrude past the cabinet's left clipping edge.
  // Its shared-depth full-screen output must preserve that last insertion too.
  await test.step('isométrica: devolver el libro del extremo izquierdo', async () => {
    await selectBook(0)
    await expectDepthTestedInsertion(page, () => page.getByRole('button', { name:'Cerrar', exact:true }).click(), 'continuity:0')
  })
  await page.screenshot({ path:'test-results/depth-tested-book-return.png' })
})

test('cancelar una devolución al cambiar el viewport restaura el libro y permite volver a seleccionarlo', async ({ page }) => {
  test.setTimeout(90_000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.setViewportSize({ width:390, height:844 })
  await page.emulateMedia({ reducedMotion:'no-preference' })
  await page.goto(process.env.IHR_TEST_URL || '/')
  await seedCoveredBooks(page)
  const bookId = 'continuity:2'
  const book = page.locator(`.ihr-spine[data-book-id="${bookId}"]`)
  const selectBook = async () => {
    await book.click()
    await expect(page.locator('.ihr-flyout__cover-target')).toBeVisible()
  }
  const cancelAtInsertion = async trigger => {
    await page.evaluate(id => {
      const scene = document.querySelector('.ihr-bookshelf-scene')
      window.__resizeCancellation = { triggered:false, originalCanvas:scene }
      const observer = new MutationObserver(() => {
        if (scene.dataset.returningBookId !== id) return
        // Dispatch exactly when the return changes renderer ownership, rather
        // than relying on a wall-clock timeout on a slow mobile GPU.
        observer.disconnect()
        window.__resizeCancellation.triggered = true
        window.dispatchEvent(new Event('resize'))
      })
      observer.observe(scene, { attributes:true, attributeFilter:['data-returning-book-id'] })
    }, bookId)
    await trigger()
    await expect.poll(() => page.evaluate(() => window.__resizeCancellation.triggered)).toBe(true)
    await expect(page.locator('.ihr-flyout')).toHaveCount(0)
    await expect(book).not.toHaveClass(/is-away/)
    await expect(page.locator('.ihr-bookshelf-scene')).not.toHaveAttribute('data-returning-book-id', bookId)
    expect(await page.evaluate(() => window.__resizeCancellation.originalCanvas ===
      document.querySelector('.ihr-bookshelf-scene'))).toBe(true)
  }
  await selectBook()
  await cancelAtInsertion(() => page.getByRole('button', { name:'Cerrar', exact:true }).click())
  await selectBook()
  await page.locator('.ihr-flyout__cover-target').click()
  await expect(page.locator('.pdf-page-canvas')).toBeVisible()
  await cancelAtInsertion(() => page.getByRole('button', { name:'Volver a la estantería' }).click())
  await selectBook()
  await expectDepthTestedInsertion(page, () => page.getByRole('button', { name:'Cerrar', exact:true }).click(), bookId)
  expect(errors).toEqual([])
})
