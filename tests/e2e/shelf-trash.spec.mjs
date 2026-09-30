import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'

const PDF_FIXTURE = 'tests/e2e/fixtures/tiny.pdf'
const PLANTS_KEY = 'inhouse-read-shelf-plants'
const DRIVE_ID = 'keep-on-drive'

test.use({ viewport:{ width:390, height:844 }, hasTouch:true, isMobile:true, deviceScaleFactor:1 })
test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion:'no-preference' })
  await page.addInitScript(() => {
    try { Object.defineProperty(window, 'showDirectoryPicker', { value:undefined, configurable:true }) }
    catch { /* Browser without File System Access. */ }
  })
  await page.goto(process.env.IHR_TEST_URL || '/')
})

async function storedLibrary(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('inhouse-read')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const all = async store => new Promise((resolve, reject) => {
      const request = db.transaction(store, 'readonly').objectStore(store).getAll()
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const books = await all('books')
    const removed = db.objectStoreNames.contains('removed-books') ? await all('removed-books') : []
    db.close()
    return {
      books:books.map(book => ({ id:book.id, name:book.name, driveFileId:book.driveFileId,
        bytes:book.content?.size, shelfPosition:book.shelfPosition })),
      removed:removed.map(book => ({ ...book, keys:Object.keys(book) }))
    }
  })
}

async function seedShelf(page, { long = false, linked = false } = {}) {
  // Import through the real file picker first, including PDF.js and its real
  // extracted cover. Extra records share those valid bytes; no mocked mesh,
  // flyout or renderer replaces the feature under test.
  await page.locator('#file-picker').setInputFiles(PDF_FIXTURE)
  await expect(page.locator('.pdf-page-canvas')).toBeVisible()
  await page.getByRole('button', { name:'Volver a la estantería' }).click()
  await expect(page.locator('#home-screen')).toBeVisible()
  await expect(page.locator('.ihr-flyout')).toHaveCount(0)
  const seed = await page.evaluate(async ({ long, linked, plantsKey, driveId }) => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('inhouse-read')
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error)
    })
    const books = await new Promise((resolve, reject) => {
      const request = db.transaction('books').objectStore('books').getAll()
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error)
    })
    const original = books.find(book => book.name === 'tiny.pdf')
    const clean = { ...original, progressFraction:0, locator:null, progressDirty:false,
      cloudAccountId:'trash-account', shelfPosition:{ shelf:0, x:.16 }, shelfOrder:0 }
    const records = [
      { ...clean, driveFileId:linked ? 'original-on-drive' : undefined },
      { ...clean, id:'trash:drive', title:'Libro en Drive', name:'drive-copy.pdf',
        driveFileId:driveId, shelfPosition:{ shelf:0, x:.42 }, shelfOrder:1 },
      { ...clean, id:'trash:survivor', title:'Libro que permanece', name:'survivor.pdf',
        driveFileId:linked ? 'survivor-on-drive' : undefined, shelfPosition:{ shelf:0, x:.66 }, shelfOrder:2 }
    ]
    if (long) for (let index=0; index<14; index++) records.push({ ...clean,
      id:`trash:long:${index}`, name:`long-${index}.pdf`, title:`Libro ${index + 4}`,
      driveFileId:`long-on-drive-${index}`, shelfPosition:{ shelf:1 + Math.floor(index / 2), x:index % 2 ? .57 : .18 },
      shelfOrder:3 + index })
    const transaction = db.transaction('books', 'readwrite')
    for (const record of records) transaction.objectStore('books').put(record)
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error)
    })
    db.close()
    const plants = [
      { key:'plant:trash-a', seed:'trash-a', variant:'cactus', width:40, shelf:0, x:.87 },
      { key:'plant:trash-b', seed:'trash-b', variant:'suculenta', width:44, shelf:1, x:.84 },
      { key:'plant:trash-c', seed:'trash-c', variant:'pothos', width:44, shelf:long ? 7 : 2, x:.85 }
    ]
    localStorage.setItem(plantsKey, JSON.stringify(plants))
    localStorage.setItem('inhouse-read-shelf-view', 'spine')
    return { originalId:original.id, ids:records.map(book => book.id), plants,
      remote:records.filter(book => book.driveFileId).map(book => ({ id:book.driveFileId, name:book.name, size:String(book.size || book.content.size), mimeType:'application/pdf' })) }
  }, { long, linked, plantsKey:PLANTS_KEY, driveId:DRIVE_ID })
  await page.reload()
  await expect(page.locator('.ihr-spine')).toHaveCount(seed.ids.length)
  await expect(page.locator('.ihr-bookshelf-scene')).toHaveAttribute('data-trash3d', 'true')
  await expect(page.locator('.ihr-bookshelf-scene')).toHaveAttribute('data-animating', 'false')
  return seed
}

async function assertBinMesh(page) {
  const bin = page.locator('.ihr-shelf-trash')
  await expect(bin).toBeVisible()
  const bounds = await bin.boundingBox(), viewport = page.viewportSize()
  expect(bounds).not.toBeNull()
  expect(bounds.width).toBeGreaterThan(25)
  expect(bounds.height).toBeGreaterThan(35)
  expect(bounds.x).toBeGreaterThan(viewport.width * .65)
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width + 1)
  expect(bounds.y).toBeGreaterThan(50)
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height + 1)
  // Its accessible DOM rectangle is only a hit target. Actual coloured pixels
  // must be present at that projected rectangle in the shelf's single canvas.
  const pixels = await page.locator('.ihr-bookshelf-scene').evaluate((canvas, bounds) => {
    const rect = canvas.getBoundingClientRect(), sx = canvas.width / rect.width, sy = canvas.height / rect.height
    const x = Math.max(0, Math.floor((bounds.x - rect.left) * sx))
    const y = Math.max(0, Math.floor((bounds.y - rect.top) * sy))
    const w = Math.min(canvas.width - x, Math.ceil(bounds.width * sx))
    const h = Math.min(canvas.height - y, Math.ceil(bounds.height * sy))
    if (w <= 0 || h <= 0) return { painted:0, contrast:0 }
    const data = canvas.getContext('2d').getImageData(x,y,w,h).data
    let painted = 0, darkest = 255, lightest = 0
    for (let i=0; i<data.length; i+=4) if (data[i+3] > 180) {
      painted++
      const value = (data[i] + data[i+1] + data[i+2]) / 3
      darkest = Math.min(darkest,value); lightest = Math.max(lightest,value)
    }
    return { painted, contrast:lightest-darkest }
  }, bounds)
  expect(pixels.painted).toBeGreaterThan(100)
  expect(pixels.contrast).toBeGreaterThan(15)
  return { x:bounds.x + bounds.width * .5, y:bounds.y + bounds.height * .45 }
}

async function beginDrag(page, id) {
  const source = page.locator(`.ihr-spine[data-book-id="${id}"]`)
  await source.evaluate(node => node.scrollIntoView({ block:'center' }))
  await expect(page.locator('.ihr-bookshelf-scene')).toHaveAttribute('data-animating', 'false')
  const rect = await source.boundingBox()
  expect(rect).not.toBeNull()
  await page.mouse.move(rect.x + Math.min(8,rect.width * .12), rect.y + rect.height * .65)
  await page.mouse.down()
  await page.waitForTimeout(450)
  await expect(source).toHaveClass(/is-lifted/)
  return source
}

async function observeDrop(page) {
  await page.evaluate(() => {
    const canvas = document.querySelector('.ihr-bookshelf-scene')
    const state = window.__shelfTrashMotion = { frames:[], events:[], image:null, lateImage:null }
    const event = event => {
      const bin = document.querySelector('.ihr-shelf-trash')?.getBoundingClientRect()
      state.events.push({ type:event.type, x:event.clientX, y:event.clientY,
        target:event.target?.dataset?.bookId || event.target?.className,
        innerWidth, innerHeight, documentWidth:document.documentElement.scrollWidth,
        arranging:document.querySelector('.ihr-bookshelf')?.classList.contains('is-arranging'),
        bin:bin && { left:bin.left, top:bin.top, right:bin.right, bottom:bin.bottom } })
    }
    document.addEventListener('pointerup',event,true)
    document.addEventListener('pointercancel',event,true)
    window.addEventListener('resize',event)
    state.stop = () => {
      state.observer.disconnect()
      document.removeEventListener('pointerup',event,true)
      document.removeEventListener('pointercancel',event,true)
      window.removeEventListener('resize',event)
    }
    state.observer = new MutationObserver(() => {
      const progress = Number(canvas.dataset.trashDropProgress)
      if (!(progress > 0 && progress < 1)) return
      state.frames.push({ progress, bookId:canvas.dataset.trashingBookId,
        activeBooks:Number(canvas.dataset.activeBooks) })
      if (!state.image && progress > .2 && progress < .8) state.image = canvas.toDataURL('image/png')
      if (!state.lateImage && progress > .65 && progress < .9) state.lateImage = canvas.toDataURL('image/png')
    })
    state.observer.observe(canvas, { attributes:true,
      attributeFilter:['data-trash-drop-progress','data-trashing-book-id'] })
  })
}

async function dropIntoBin(page, id, testInfo) {
  await beginDrag(page, id)
  const bin = await assertBinMesh(page)
  await observeDrop(page)
  await page.mouse.move(bin.x, bin.y, { steps:14 })
  await expect(page.locator('.ihr-spine.is-dragging')).toHaveAttribute('data-book-id', id)
  await expect(page.locator('.ihr-bookshelf-scene')).toHaveAttribute('data-trash-hover', 'true')
  await page.mouse.up()
  try {
    await expect.poll(async () => (await storedLibrary(page)).books.some(book => book.id === id)).toBe(false)
  } catch (error) {
    const diagnostics = await page.evaluate(() => {
      const state = window.__shelfTrashMotion
      state.stop()
      return { events:state.events, frames:state.frames,
        canvas:document.querySelector('.ihr-bookshelf-scene')?.dataset,
        shelfClass:document.querySelector('.ihr-bookshelf')?.className,
        status:document.querySelector('.ihr-trash-status')?.textContent }
    })
    await testInfo.attach('trash-failure-diagnostics', { body:JSON.stringify(diagnostics,null,2), contentType:'application/json' })
    console.log('Trash failure diagnostics:',JSON.stringify(diagnostics))
    throw error
  }
  await expect(page.locator(`.ihr-spine[data-book-id="${id}"]`)).toHaveCount(0)
  await expect(page.locator('.ihr-flyout')).toHaveCount(0)
  await expect(page.locator('.ihr-bookshelf')).not.toHaveClass(/is-arranging/)
  const motion = await page.evaluate(() => {
    const state = window.__shelfTrashMotion
    state.stop()
    return { frames:state.frames, image:state.image, lateImage:state.lateImage }
  })
  expect(motion.frames.length).toBeGreaterThan(2)
  expect(motion.frames.every(frame => frame.progress > 0 && frame.progress < 1)).toBe(true)
  expect(motion.frames.some(frame => frame.bookId === id)).toBe(true)
  expect(motion.frames.at(-1).progress).toBeGreaterThan(motion.frames[0].progress)
  expect(motion.image).toBeTruthy()
  expect(motion.lateImage).toBeTruthy()
  await testInfo.attach('book-entering-real-3d-bin', { body:Buffer.from(motion.image.split(',')[1], 'base64'), contentType:'image/png' })
  await testInfo.attach('book-landing-inside-real-3d-bin', { body:Buffer.from(motion.lateImage.split(',')[1], 'base64'), contentType:'image/png' })
  await testInfo.attach('bin-animation-frames', { body:JSON.stringify(motion.frames,null,2), contentType:'application/json' })
  const removed = (await storedLibrary(page)).removed.find(book => book.id === id)
  expect(removed).toBeTruthy()
  expect(removed.removedAt).toBeGreaterThan(0)
  expect(removed.keys).not.toEqual(expect.arrayContaining(['content']))
  for (const field of ['content','cover','locator','readingHistory','bookmarks','quotes']) expect(removed.keys).not.toContain(field)
}

test('papelera 3D: retira la copia de la app con animación en un móvil de 320 px y conserva los otros libros y plantas', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  await page.setViewportSize({ width:320, height:844 })
  const errors = []; page.on('pageerror', error => errors.push(error.message))
  const fixtureBefore = await readFile(PDF_FIXTURE)
  const seed = await seedShelf(page)
  await dropIntoBin(page, seed.originalId, testInfo)
  await expect(page.locator('.ihr-spine')).toHaveCount(2)
  await expect(page.locator('.ihr-plant')).toHaveCount(3)
  const beforeReload = await storedLibrary(page)
  expect(beforeReload.books.map(book => book.id).sort()).toEqual(seed.ids.filter(id => id !== seed.originalId).sort())
  expect(beforeReload.books.every(book => book.bytes === fixtureBefore.length)).toBe(true)
  await page.reload()
  await expect(page.locator('.ihr-spine')).toHaveCount(2)
  expect((await storedLibrary(page)).books.map(book => book.id).sort()).toEqual(beforeReload.books.map(book => book.id).sort())
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), PLANTS_KEY)).toEqual(seed.plants)
  expect(await readFile(PDF_FIXTURE)).toEqual(fixtureBefore)
  await assertBinMesh(page)
  expect(errors).toEqual([])
})

test('un libro retirado sigue en Drive y la sincronización automática no lo vuelve a añadir', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  const seed = await seedShelf(page, { linked:true })
  const requests = []; let remoteLists = 0
  await page.route('https://www.googleapis.com/drive/v3/about?**', route => route.fulfill({
    status:200, contentType:'application/json', body:JSON.stringify({ user:{ permissionId:'trash-account', displayName:'Miguel', emailAddress:'trash@example.com' } })
  }))
  await page.route('https://www.googleapis.com/drive/v3/files**', route => {
    const request = route.request(), url = new URL(request.url()), query = url.searchParams.get('q') || ''
    requests.push({ method:request.method(), url:request.url(), body:request.postData() })
    let files = []
    if (query.includes("name = '.inhouse-read-state'")) files = [{ id:'state-folder', name:'.inhouse-read-state' }]
    else if (query.includes("name = 'inhouse read'")) files = [{ id:'read-folder', name:'inhouse read' }]
    else if (query.includes("'read-folder' in parents")) { files = seed.remote; remoteLists++ }
    return route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ files }) })
  })
  await page.evaluate(() => localStorage.setItem('ihr_drive_session_v2', JSON.stringify({ accessToken:'shelf-trash-test', expiresAt:Date.now() + 3600_000 })))
  await page.reload()
  await expect.poll(() => remoteLists).toBeGreaterThan(0)
  await expect(page.locator('#drive-profile')).toBeVisible()
  await expect(page.locator('.ihr-spine')).toHaveCount(3)
  await dropIntoBin(page, 'trash:drive', testInfo)
  expect((await storedLibrary(page)).removed.find(book => book.id === 'trash:drive')).toMatchObject({ driveFileId:DRIVE_ID })
  const listsBefore = remoteLists
  await page.reload()
  await expect.poll(() => remoteLists).toBeGreaterThan(listsBefore)
  await expect(page.locator('.ihr-spine')).toHaveCount(2)
  await expect(page.locator('.ihr-spine[data-book-id="trash:drive"]')).toHaveCount(0)
  expect((await storedLibrary(page)).books.some(book => book.driveFileId === DRIVE_ID)).toBe(false)
  expect(seed.remote.some(book => book.id === DRIVE_ID)).toBe(true)
  expect(requests.some(request => request.method === 'DELETE')).toBe(false)
  expect(requests.some(request => request.body?.includes('"trashed":true'))).toBe(false)
  await expect(page.locator('.ihr-plant')).toHaveCount(3)
})

test('entrar en la papelera y soltar fuera cancela la eliminación y mantiene los archivos', async ({ page }) => {
  test.setTimeout(90_000)
  const seed = await seedShelf(page)
  const source = await beginDrag(page, seed.originalId)
  const bin = await assertBinMesh(page)
  await page.mouse.move(bin.x, bin.y, { steps:14 })
  await expect(page.locator('.ihr-bookshelf-scene')).toHaveAttribute('data-trash-hover', 'true')
  // Return to the original slot. A hover must never commit the action.
  const original = await page.locator('.ihr-shelf').first().boundingBox()
  await page.mouse.move(original.x + original.width * .16, original.y + original.height * .7, { steps:12 })
  await expect(page.locator('.ihr-bookshelf-scene')).toHaveAttribute('data-trash-hover', 'false')
  await page.mouse.up()
  await expect(source).not.toHaveClass(/is-dragging|is-lifted/)
  await expect(page.locator('.ihr-bookshelf')).not.toHaveClass(/is-arranging/)
  await expect(page.locator('.ihr-bookshelf-scene')).toHaveAttribute('data-animating', 'false')
  await expect(page.locator('.ihr-spine')).toHaveCount(3)
  expect((await storedLibrary(page)).removed).toEqual([])
  await page.reload()
  await expect(page.locator('.ihr-spine')).toHaveCount(3)
  expect((await storedLibrary(page)).books.map(book => book.id).sort()).toEqual(seed.ids.sort())
  await expect(page.locator('.ihr-flyout')).toHaveCount(0)
})

test('la papelera permanece accesible al bajar por una estantería larga en la vista isométrica', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  const seed = await seedShelf(page, { long:true })
  const scene = page.locator('.ihr-bookshelf-scene')
  const scroller = page.locator('.ihr-bookshelf__scroll')
  expect(await scroller.evaluate(node => node.scrollHeight / node.clientHeight)).toBeGreaterThan(2)
  await page.getByRole('button', { name:'Vista isométrica, libros de lado' }).click()
  await expect(scene).toHaveAttribute('data-view-progress', '1')
  await expect(scene).toHaveAttribute('data-animating', 'false')
  // The isometric camera intentionally zooms the whole tall cabinet out.
  // It still extends beyond the viewport and must support scrolling to its
  // bottom without losing the bin hit target.
  expect(await scroller.evaluate(node => node.scrollHeight / node.clientHeight)).toBeGreaterThan(1.3)
  await scroller.evaluate(node => { node.scrollTop = node.scrollHeight })
  await expect.poll(() => scroller.evaluate(node => node.scrollTop)).toBeGreaterThan(400)
  await assertBinMesh(page)
  const lastId = 'trash:long:13'
  await expect(page.locator(`.ihr-spine[data-book-id="${lastId}"]`)).toBeVisible()
  await dropIntoBin(page, lastId, testInfo)
  await expect(page.locator('.ihr-spine')).toHaveCount(seed.ids.length - 1)
  await expect(scene).toHaveAttribute('data-shelf-view', 'isometric')
  await expect(scene).toHaveAttribute('data-animating', 'false')
  await assertBinMesh(page)
  await page.reload()
  await expect(page.locator('.ihr-spine')).toHaveCount(seed.ids.length - 1)
  await expect(page.locator(`.ihr-spine[data-book-id="${lastId}"]`)).toHaveCount(0)
  await expect(page.locator('.ihr-bookshelf')).toHaveAttribute('data-view-mode', 'isometric')
  await expect(page.locator('.ihr-plant')).toHaveCount(3)
})
