import { expect, test } from '@playwright/test'
import { spinePointerPosition } from './helpers/shelf-pointer.mjs'
import { readFile } from 'node:fs/promises'

const PDF_FIXTURE = 'tests/e2e/fixtures/tiny.pdf'
const PLANTS_KEY = 'inhouse-read-shelf-plants'
const DRIVE_ID = 'keep-on-drive'

// At 50 ms of camera time per rendered frame, CI reached .98 after 8.3 s
// but needed further real frames. Keep the exact endpoint and geometry checks.
const VIEW_TRANSITION_TIMEOUT = 30_000

function savedDrivePdf() {
  const colours = ['.72 .08 .15', '.08 .22 .78', '.1 .52 .23']
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [4 0 R 6 0 R 8 0 R] /Count 3 >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
  for (let index=0; index<3; index++) {
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 600] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + index * 2} 0 R >>`)
    const text = index === 1 ? 'Saved Drive reading page 2.' : `Drive document page ${index + 1}.`
    const stream = `${colours[index]} rg 0 0 400 600 re f\n1 1 1 rg BT /F1 23 Tf 30 540 Td (${text}) Tj ET`
    objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`)
  }
  let output = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(output))
    output += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xref = Buffer.byteLength(output)
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  output += offsets.slice(1).map(offset => `${String(offset).padStart(10,'0')} 00000 n \n`).join('')
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(output)
}

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
        bytes:book.content?.size, shelfPosition:book.shelfPosition, locator:book.locator,
        progressFraction:book.progressFraction, author:book.author, spineTitleOverride:book.spineTitleOverride })),
      removed:removed.map(book => ({ ...book, keys:Object.keys(book) }))
    }
  })
}

async function seedShelf(page, { long = false, linked = false, driveBytes = null } = {}) {
  // Import through the real file picker first, including PDF.js and its real
  // extracted cover. Extra records share those valid bytes; no mocked mesh,
  // flyout or renderer replaces the feature under test.
  await page.locator('#file-picker').setInputFiles(PDF_FIXTURE)
  await expect(page.locator('.pdf-page-canvas')).toBeVisible()
  await page.getByRole('button', { name:'Volver a la estantería' }).click()
  // Home becomes visible while the return book is still zooming/closing.
  // CI reached those phases after the old eight-second layer check expired.
  await expect(page.locator('body')).toHaveClass(/is-closing-reader/)
  await expect(page.locator('body')).not.toHaveClass(/is-closing-reader/,{ timeout:30_000 })
  await expect(page.locator('#home-screen')).toBeVisible()
  await expect(page.locator('.ihr-flyout')).toHaveCount(0)
  const seed = await page.evaluate(async ({ long, linked, driveBytes, plantsKey, driveId }) => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('inhouse-read')
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error)
    })
    const books = await new Promise((resolve, reject) => {
      const request = db.transaction('books').objectStore('books').getAll()
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error)
    })
    const original = books.find(book => book.name === 'tiny.pdf')
    // Short fixtures begin on the final shelf. Long fixtures retain top and
    // bottom records: the isometric overview must show both, without moving
    // records or scrolling the cabinet to make a drop possible.
    const fixtureShelf = long ? 0 : 2
    const clean = { ...original, progressFraction:0, locator:null, progressDirty:false,
      cloudAccountId:'trash-account', shelfPosition:{ shelf:fixtureShelf, x:.16 }, shelfOrder:0 }
    const records = [
      { ...clean, driveFileId:linked ? 'original-on-drive' : undefined },
      { ...clean, id:'trash:drive', title:'Libro en Drive', name:'drive-copy.pdf',
        driveFileId:driveId, shelfPosition:{ shelf:fixtureShelf, x:.42 }, shelfOrder:1 },
      { ...clean, id:'trash:survivor', title:'Libro que permanece', name:'survivor.pdf',
        driveFileId:linked ? 'survivor-on-drive' : undefined, shelfPosition:{ shelf:fixtureShelf, x:.66 }, shelfOrder:2 }
    ]
    if (driveBytes) Object.assign(records[1], {
      content:new Blob([new Uint8Array(driveBytes)], { type:'application/pdf' }),
      size:driveBytes.length, sizeBytes:driveBytes.length, pageCount:3
    })
    if (long) for (let index=0; index<18; index++) records.push({ ...clean,
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
      { key:'plant:trash-c', seed:'trash-c', variant:'pothos', width:44, shelf:long ? 9 : 2, x:.85 }
    ]
    localStorage.setItem(plantsKey, JSON.stringify(plants))
    localStorage.setItem('inhouse-read-shelf-view', 'spine')
    // Since the IKEA plant sizing (1.7.3) a legacy record migrates to the real
    // pot and plant dimensions of its catalogue model, not to the old px sizes.
    const migratedPlants = [
      { ...plants[0], catalogId:'cactus', potId:'akerbar', width:140, height:180 },
      { ...plants[1], catalogId:'succulent', variant:'succulent', potId:'muskotblomma', width:160, height:207 },
      { ...plants[2], catalogId:'hedera', variant:'hedera', potId:'muskotblomma', width:180, height:240 }
    ]
    return { originalId:original.id, ids:records.map(book => book.id), plants:migratedPlants,
      remote:records.filter(book => book.driveFileId).map(book => ({ id:book.driveFileId, name:book.name, size:String(book.size || book.content.size), mimeType:'application/pdf' })) }
  }, { long, linked, driveBytes, plantsKey:PLANTS_KEY, driveId:DRIVE_ID })
  await page.reload()
  await expect(page.locator('.ihr-spine')).toHaveCount(seed.ids.length)
  await expect(page.locator('.ihr-bookshelf-scene')).toHaveAttribute('data-trash3d', 'true')
  await expect(page.locator('.ihr-bookshelf-scene')).toHaveAttribute('data-animating', 'false')
  await expect(page.locator('.ihr-shelf-trash')).toBeHidden()
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), PLANTS_KEY)).toEqual(seed.plants)
  return seed
}

async function useIsometricShelf(page) {
  if (await page.locator('.ihr-bookshelf').getAttribute('data-view-mode') !== 'isometric')
    await page.getByRole('button', { name:'Vista isométrica, libros de lado' }).click()
  await expect(page.locator('.ihr-bookshelf-scene')).toHaveAttribute('data-view-progress', '1', { timeout:VIEW_TRANSITION_TIMEOUT })
  await expect(page.locator('.ihr-bookshelf-scene')).toHaveAttribute('data-animating', 'false')
}

async function assertCabinetOverview(page) {
  const scroller = page.locator('.ihr-bookshelf__scroll')
  const scene = page.locator('.ihr-bookshelf-scene')
  await expect(scene).toHaveAttribute('data-animating', 'false')
  await expect(scene).toHaveAttribute('data-full-cabinet-in-frame', 'true')
  await expect(scene).toHaveAttribute('data-floor-visible', 'false')
  const scroll = await scroller.evaluate(node => ({ top:node.scrollTop,height:node.scrollHeight,available:node.clientHeight }))
  expect(scroll.top).toBe(0)
  expect(scroll.height).toBeLessThanOrEqual(scroll.available + 1)
  await expect(page.locator('.ihr-shelf-trash')).toBeVisible()
  await expect(scene).toHaveAttribute('data-trash-visible', 'true')
}

async function assertBinMesh(page) {
  const bin = page.locator('.ihr-shelf-trash')
  await expect(page.locator('.ihr-bookshelf-scene')).toHaveAttribute('data-shelf-view', 'isometric')
  await expect(page.locator('.ihr-bookshelf-scene')).toHaveAttribute('data-trash-visible', 'true')
  await expect(bin).toBeVisible()
  await expect(bin).toHaveAttribute('aria-hidden', 'false')
  const bounds = await bin.boundingBox(), viewport = page.viewportSize()
  expect(bounds).not.toBeNull()
  expect(bounds.width).toBeGreaterThanOrEqual(44)
  expect(bounds.height).toBeGreaterThanOrEqual(44)
  expect(bounds.x).toBeGreaterThan(viewport.width * .5)
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width + 1)
  expect(bounds.y).toBeGreaterThan(50)
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height + 1)
  const contact = await page.locator('.ihr-bookshelf-scene').evaluate(node => ({
    foot:Number(node.dataset.trashFootY), floor:Number(node.dataset.cabinetFloorY),
    scale:Number(node.dataset.trashLocalScale), rotation:node.dataset.trashLocalRotation
  }))
  expect(Number.isFinite(contact.foot)).toBe(true)
  expect(Number.isFinite(contact.floor)).toBe(true)
  expect(contact.foot).toBeCloseTo(contact.floor, 5)
  expect(contact.scale).toBe(1)
  expect(contact.rotation.split(',').map(Number)).toEqual([0,0,0])
  await expect(page.locator('.ihr-bookshelf-scene')).toHaveAttribute('data-trash-radius','44')
  await expect(page.locator('.ihr-bookshelf-scene')).toHaveAttribute('data-trash-height','140')
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
  const current = await source.boundingBox(), clip = await page.locator('.ihr-bookshelf__scroll').boundingBox()
  if (!current || current.y < Math.max(0,clip.y) ||
    current.y + current.height > Math.min(page.viewportSize().height,clip.y + clip.height))
    await source.evaluate(node => node.scrollIntoView({ block:'nearest' }))
  await expect(page.locator('.ihr-bookshelf-scene')).toHaveAttribute('data-animating', 'false')
  const rect = await source.boundingBox()
  expect(rect).not.toBeNull()
  const grab = await spinePointerPosition(source,rect)
  await page.mouse.move(rect.x + grab.x,rect.y + grab.y)
  await page.mouse.down()
  await page.waitForTimeout(450)
  await expect(source).toHaveClass(/is-lifted/)
  return source
}

async function observeDrop(page) {
  await page.evaluate(() => {
    const canvas = document.querySelector('.ihr-bookshelf-scene')
    const pose = () => ({ position:canvas.dataset.trashLocalPosition,
      scale:Number(canvas.dataset.trashLocalScale),rotation:canvas.dataset.trashLocalRotation,
      foot:Number(canvas.dataset.trashFootY),floor:Number(canvas.dataset.cabinetFloorY) })
    const state = window.__shelfTrashMotion = { baseline:pose(), frames:[], events:[], image:null, lateImage:null }
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
        activeBooks:Number(canvas.dataset.activeBooks),...pose() })
      if (!state.image && progress > .2 && progress < .8) state.image = canvas.toDataURL('image/png')
      if (!state.lateImage && progress > .65 && progress < .9) state.lateImage = canvas.toDataURL('image/png')
    })
    state.observer.observe(canvas, { attributes:true,
      attributeFilter:['data-trash-drop-progress','data-trashing-book-id'] })
  })
}

async function shelfScrollDiagnostics(page) {
  return page.evaluate(() => {
    const scroller = document.querySelector('.ihr-bookshelf__scroll')
    const stage = document.querySelector('.ihr-shelf-stage')
    const canvas = document.querySelector('.ihr-bookshelf-scene')
    const bounds = node => {
      if (!node) return null
      const { left,top,right,bottom,width,height } = node.getBoundingClientRect()
      return { left,top,right,bottom,width,height }
    }
    const clip = bounds(scroller), cabinet = bounds(stage)
    const scrollStyle = getComputedStyle(scroller), stageStyle = getComputedStyle(stage)
    const physicalContentBottom = cabinet.bottom - clip.top + scroller.scrollTop + parseFloat(scrollStyle.paddingBottom)
    const object = node => ({
      key:node.dataset.objectId,bookId:node.dataset.bookId,classes:node.className,
      rect:bounds(node),style:node.getAttribute('style'),dataset:{ ...node.dataset },
      dragging:node.classList.contains('is-dragging'),lifted:node.classList.contains('is-lifted'),
      away:node.classList.contains('is-away')
    })
    return {
      viewport:{ width:innerWidth,height:innerHeight,devicePixelRatio,
        visual:visualViewport && { top:visualViewport.offsetTop,height:visualViewport.height } },
      scroll:{ top:scroller.scrollTop,height:scroller.scrollHeight,clientHeight:scroller.clientHeight,
        width:scroller.clientWidth,max:scroller.scrollHeight - scroller.clientHeight,
        remaining:scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop,
        physicalContentBottom,overflowBeyondCabinet:scroller.scrollHeight - Math.ceil(physicalContentBottom),
        rect:clip,paddingTop:scrollStyle.paddingTop,paddingBottom:scrollStyle.paddingBottom },
      stage:{ rect:cabinet,offsetHeight:stage.offsetHeight,clientHeight:stage.clientHeight,
        style:stage.getAttribute('style'),overflowX:stageStyle.overflowX,overflowY:stageStyle.overflowY,
        contain:stageStyle.contain,position:stageStyle.position },
      canvas:{ rect:bounds(canvas),width:canvas.width,height:canvas.height,dataset:{ ...canvas.dataset } },
      shelfClass:document.querySelector('.ihr-bookshelf')?.className,
      bin:{ rect:bounds(document.querySelector('.ihr-shelf-trash')),
        hidden:document.querySelector('.ihr-shelf-trash')?.hidden,
        dataset:{ ...document.querySelector('.ihr-shelf-trash')?.dataset } },
      objects:[...document.querySelectorAll('.ihr-spine,.ihr-plant')].map(object)
    }
  })
}

async function dropIntoBin(page, id, testInfo) {
  await useIsometricShelf(page)
  await assertCabinetOverview(page)
  await beginDrag(page, id)
  await finishDropIntoBin(page,id,testInfo)
}

async function finishDropIntoBin(page, id, testInfo) {
  const bin = await assertBinMesh(page)
  await observeDrop(page)
  await page.mouse.move(bin.x, bin.y, { steps:14 })
  await expect(page.locator('.ihr-spine.is-dragging')).toHaveAttribute('data-book-id', id)
  await expect(page.locator('.ihr-bookshelf-scene')).toHaveAttribute('data-trash-hover', 'true')
  await page.mouse.up()
  try {
    // CI renders these real 3D frames in software. Give the bounded animation
    // time to land before asserting its persisted removal; never skip frames
    // or accept a book that still exists in the app's library.
    await expect.poll(async () => (await storedLibrary(page)).books.some(book => book.id === id), {
      timeout:30_000
    }).toBe(false)
  } catch (error) {
    const diagnostics = await page.evaluate(() => {
      const state = window.__shelfTrashMotion
      state.stop()
      return { baseline:state.baseline,events:state.events, frames:state.frames,
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
  await assertCabinetOverview(page)
  const motion = await page.evaluate(() => {
    const state = window.__shelfTrashMotion
    state.stop()
    return { baseline:state.baseline,frames:state.frames, image:state.image, lateImage:state.lateImage }
  })
  expect(motion.frames.length).toBeGreaterThan(2)
  expect(motion.frames.every(frame => frame.progress > 0 && frame.progress < 1)).toBe(true)
  expect(motion.frames.some(frame => frame.bookId === id)).toBe(true)
  expect(motion.frames.at(-1).progress).toBeGreaterThan(motion.frames[0].progress)
  expect(motion.baseline.scale).toBe(1)
  expect(motion.baseline.rotation.split(',').map(Number)).toEqual([0,0,0])
  expect(motion.baseline.foot).toBeCloseTo(motion.baseline.floor,5)
  for (const frame of motion.frames) {
    // The physical basket stays rigid throughout the flight. Library reflow
    // happens only after the landed book's stored record has been removed.
    expect(frame.position).toBe(motion.baseline.position)
    expect(frame.scale).toBe(motion.baseline.scale)
    expect(frame.rotation).toBe(motion.baseline.rotation)
    expect(frame.foot).toBeCloseTo(frame.floor,5)
    expect(frame.floor).toBe(motion.baseline.floor)
  }
  expect(motion.image).toBeTruthy()
  expect(motion.lateImage).toBeTruthy()
  await testInfo.attach('book-entering-real-3d-bin', { body:Buffer.from(motion.image.split(',')[1], 'base64'), contentType:'image/png' })
  await testInfo.attach('book-landing-inside-real-3d-bin', { body:Buffer.from(motion.lateImage.split(',')[1], 'base64'), contentType:'image/png' })
  await testInfo.attach('bin-animation-frames', { body:JSON.stringify(motion.frames,null,2), contentType:'application/json' })
  await testInfo.attach('bin-animation-baseline', { body:JSON.stringify(motion.baseline,null,2), contentType:'application/json' })
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
  await assertCabinetOverview(page)
  await assertBinMesh(page)
  expect(errors).toEqual([])
})

test('retirar un libro no muestra aviso, no enlaza shaders y no reconstruye la escena 3D', async ({ page }, testInfo) => {
  test.setTimeout(150_000)
  // Counts every shader program link from the next navigation on. A removal
  // must reuse the programs the shelf already holds.
  await page.addInitScript(() => {
    window.__programLinks = 0
    for (const Context of [window.WebGL2RenderingContext, window.WebGLRenderingContext]) {
      if (!Context) continue
      const link = Context.prototype.linkProgram
      Context.prototype.linkProgram = function (...args) { window.__programLinks++; return link.apply(this, args) }
    }
  })
  const seed = await seedShelf(page)
  await useIsometricShelf(page)
  await assertCabinetOverview(page)
  const scene = page.locator('.ihr-bookshelf-scene')
  await page.waitForTimeout(500)
  const before = await page.evaluate(() => {
    const canvas = document.querySelector('.ihr-bookshelf-scene')
    canvas.dataset.sameSceneProbe = 'kept'
    window.__programLinks = 0
    return { activeBooks:Number(canvas.dataset.activeBooks), spines:document.querySelectorAll('.ihr-spine').length,
      layoutUpdates:Number(canvas.dataset.layoutUpdates || 0) }
  })
  expect(before.spines).toBe(3)
  await beginDrag(page, seed.originalId)
  await finishDropIntoBin(page, seed.originalId, testInfo)
  await expect(page.locator('.ihr-spine')).toHaveCount(2)
  await expect(scene).toHaveAttribute('data-animating', 'false')
  const after = await page.evaluate(() => {
    const canvas = document.querySelector('.ihr-bookshelf-scene')
    return { same:canvas.dataset.sameSceneProbe, activeBooks:Number(canvas.dataset.activeBooks),
      layoutUpdates:Number(canvas.dataset.layoutUpdates || 0), links:window.__programLinks,
      visibleStatus:document.querySelector('.ihr-trash-status')?.textContent,
      statusBox:document.querySelector('.ihr-trash-status').getBoundingClientRect().height,
      live:document.querySelector('.ihr-trash-announce')?.textContent,
      liveBox:document.querySelector('.ihr-trash-announce').getBoundingClientRect() }
  })
  // The same scene (canvas, renderer, GPU programs) survives: it is updated,
  // never rebuilt, and the book count in it drops by exactly one.
  expect(after.same).toBe('kept')
  expect(after.activeBooks).toBe(before.activeBooks - 1)
  expect(after.layoutUpdates - before.layoutUpdates).toBeLessThanOrEqual(1)
  expect(after.links).toBe(0)
  // No visible 'retirado' pill; the announcement stays in a hidden live region.
  expect(after.visibleStatus).toBe('')
  expect(after.statusBox).toBe(0)
  expect(after.live).toContain('retirado de la estantería')
  expect(after.liveBox.width).toBeLessThanOrEqual(1)
  expect(after.liveBox.height).toBeLessThanOrEqual(1)
})

test('un libro retirado sigue en Drive y la sincronización automática no lo vuelve a añadir', async ({ page }, testInfo) => {
  // Two reader round trips, a camera turn, a 3D drop and Drive reimport all
  // render under software GL. Preserve every local deadline and assertion.
  test.setTimeout(240_000)
  const drivePdf = savedDrivePdf()
  const seed = await seedShelf(page, { linked:true, driveBytes:[...drivePdf] })
  const savedProgress = {
    schemaVersion:1, driveFileId:DRIVE_ID, fraction:.5, locator:{ kind:'pdf-page', value:2 },
    appearance:{ author:'Ursula Le Guin', spineTitleOverride:'Mi libro en Drive' },
    updatedAt:Date.now() + 60_000
  }
  const requests = []; let remoteLists = 0, stateReads = 0, fileDownloads = 0
  await page.route('https://www.googleapis.com/drive/v3/about?**', route => route.fulfill({
    status:200, contentType:'application/json', body:JSON.stringify({ user:{ permissionId:'trash-account', displayName:'Miguel', emailAddress:'trash@example.com' } })
  }))
  await page.route('https://www.googleapis.com/drive/v3/files**', route => {
    const request = route.request(), url = new URL(request.url()), query = url.searchParams.get('q') || ''
    requests.push({ method:request.method(), url:request.url(), body:request.postData() })
    if (url.pathname.endsWith('/saved-state') && url.searchParams.get('alt') === 'media') {
      stateReads++
      return route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(savedProgress) })
    }
    if (url.pathname.endsWith(`/${DRIVE_ID}`) && url.searchParams.get('alt') === 'media') {
      fileDownloads++
      return route.fulfill({ status:200, contentType:'application/pdf', body:drivePdf })
    }
    let files = []
    if (query.includes("name = '.inhouse-read-state'")) files = [{ id:'state-folder', name:'.inhouse-read-state' }]
    else if (query.includes("name = 'inhouse read'")) files = [{ id:'read-folder', name:'inhouse read' }]
    else if (query.includes("'read-folder' in parents")) { files = seed.remote; remoteLists++ }
    else if (query.includes(`name = 'progress-${DRIVE_ID}.json'`)) files = [{
      id:'saved-state', name:`progress-${DRIVE_ID}.json`, modifiedTime:new Date(savedProgress.updatedAt).toISOString()
    }]
    return route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ files }) })
  })
  await page.evaluate(() => localStorage.setItem('ihr_drive_session_v2', JSON.stringify({ accessToken:'shelf-trash-test', expiresAt:Date.now() + 3600_000 })))
  await page.reload()
  await expect.poll(() => remoteLists).toBeGreaterThan(0)
  await expect(page.locator('#drive-profile')).toBeVisible()
  await expect(page.locator('.ihr-spine')).toHaveCount(3)
  await expect.poll(async () => (await storedLibrary(page)).books.find(book => book.id === 'trash:drive'))
    .toMatchObject({ locator:savedProgress.locator, progressFraction:.5, author:'Ursula Le Guin' })
  await dropIntoBin(page, 'trash:drive', testInfo)
  expect((await storedLibrary(page)).removed.find(book => book.id === 'trash:drive')).toMatchObject({ driveFileId:DRIVE_ID })
  const listsBefore = remoteLists
  await page.reload()
  await expect.poll(() => remoteLists).toBeGreaterThan(listsBefore)
  await expect(page.locator('.ihr-spine')).toHaveCount(2)
  await expect(page.locator('.ihr-spine[data-book-id="trash:drive"]')).toHaveCount(0)
  expect((await storedLibrary(page)).books.some(book => book.driveFileId === DRIVE_ID)).toBe(false)
  expect(seed.remote.some(book => book.id === DRIVE_ID)).toBe(true)
  await expect(page.locator('.ihr-plant')).toHaveCount(3)

  // Merely opening the Drive list still must not restore a removed entry.
  // Only the user's explicit click clears the identity marker and imports
  // the unchanged remote file together with its last saved reading place.
  await page.getByRole('button', { name:'Abrir desde Google Drive', exact:true }).click()
  await expect(page.locator('#drive-modal')).toBeVisible()
  const remoteBook = page.locator('.drive-item').filter({ hasText:'drive-copy.pdf' })
  await expect(remoteBook).toBeVisible()
  expect((await storedLibrary(page)).books.some(book => book.driveFileId === DRIVE_ID)).toBe(false)
  const readsBeforeImport = stateReads
  await remoteBook.click()
  await expect(page.locator('#reader-screen')).toBeVisible()
  await expect(page.locator('#reader-location')).toHaveAttribute('aria-label', /Página 2 de 3/)
  await expect(page.locator('#reader-top-byline')).toHaveText('Ursula Le Guin')
  const restored = await storedLibrary(page)
  expect(restored.books.find(book => book.driveFileId === DRIVE_ID)).toMatchObject({
    id:`drive:${DRIVE_ID}`, bytes:drivePdf.length, locator:savedProgress.locator,
    progressFraction:.5, author:'Ursula Le Guin', spineTitleOverride:'Mi libro en Drive'
  })
  expect(restored.removed.some(book => book.driveFileId === DRIVE_ID)).toBe(false)
  expect(fileDownloads).toBe(1)
  expect(stateReads).toBeGreaterThan(readsBeforeImport)
  const pixel = await page.locator('.pdf-page-canvas').evaluate(canvas =>
    [...canvas.getContext('2d').getImageData(canvas.width / 2,canvas.height / 2,1,1).data])
  expect(pixel[2]).toBeGreaterThan(120)
  expect(pixel[2]).toBeGreaterThan(pixel[0] * 3)
  expect(pixel[2]).toBeGreaterThan(pixel[1] * 2)
  await testInfo.attach('explicit-drive-reimport-restored-blue-page-2', {
    body:await page.locator('.pdf-page-canvas').screenshot(), contentType:'image/png'
  })
  await page.getByRole('button', { name:'Volver a la estantería' }).click()
  await expect(page.locator('body')).not.toHaveClass(/is-closing-reader/,{timeout:20_000})
  await expect(page.locator('.ihr-spine')).toHaveCount(3)
  await expect(page.locator(`.ihr-spine[data-book-id="drive:${DRIVE_ID}"]`)).toBeVisible()
  await expect(page.locator('.ihr-plant')).toHaveCount(3)
  expect(requests.some(request => request.method === 'DELETE')).toBe(false)
  expect(requests.some(request => request.body?.includes('"trashed":true'))).toBe(false)
})

test('entrar en la papelera y soltar fuera cancela la eliminación y mantiene los archivos', async ({ page }) => {
  // The outward and return drags each draw every pointer step in software GL;
  // leave room for both paths after seeding, reader closure and camera turn.
  test.setTimeout(180_000)
  const seed = await seedShelf(page)
  await useIsometricShelf(page)
  await assertCabinetOverview(page)
  const original = await page.locator(`.ihr-spine[data-book-id="${seed.originalId}"]`).boundingBox()
  const source = await beginDrag(page, seed.originalId)
  const bin = await assertBinMesh(page)
  await page.mouse.move(bin.x, bin.y, { steps:14 })
  await expect(page.locator('.ihr-bookshelf-scene')).toHaveAttribute('data-trash-hover', 'true')
  // Return to the original slot. A hover must never commit the action.
  await page.mouse.move(original.x + original.width * .5, original.y + original.height * .7, { steps:12 })
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

test('la estantería larga cabe entera en isométrica y permite llevar libros superiores directamente a la papelera sin scroll', async ({ page }, testInfo) => {
  test.setTimeout(180_000)
  const seed = await seedShelf(page, { long:true })
  const scene = page.locator('.ihr-bookshelf-scene')
  const scroller = page.locator('.ihr-bookshelf__scroll')
  // Ten populated shelf slots now occupy four real 600 × 250 × 1160 mm
  // cabinets side by side; the old vertically stretched cabinet no longer
  // creates the frontal scrollbar this fixture used to require.
  await expect(scene).toHaveAttribute('data-shelf-units', '4')
  await expect(scene).toHaveAttribute('data-active-books', '21')
  expect(JSON.parse(await scene.getAttribute('data-shelf-dimensions')))
    .toEqual({ width:600, depth:250, height:1160 })
  await testInfo.attach('four-real-cabinets-before-overview', {
    body:JSON.stringify(await shelfScrollDiagnostics(page), null, 2), contentType:'application/json'
  })
  await page.getByRole('button', { name:'Vista isométrica, libros de lado' }).click()
  await expect(scene).toHaveAttribute('data-view-progress', '1', { timeout:VIEW_TRANSITION_TIMEOUT })
  await expect(scene).toHaveAttribute('data-animating', 'false')
  // The entire tall cabinet and grounded basket fit together. Wheel input
  // must not turn the overview into the old scrollable partial view.
  await assertCabinetOverview(page)
  const readGroundPose = () => scene.evaluate(node => ({
    position:node.dataset.trashLocalPosition.split(',').map(Number),
    floor:Number(node.dataset.cabinetFloorY),foot:Number(node.dataset.trashFootY),
    scale:Number(node.dataset.trashLocalScale),rotation:node.dataset.trashLocalRotation
  }))
  const assertGroundedReflow = (before,after) => {
    expect(after.position[0]).toBe(before.position[0])
    expect(after.position[2]).toBe(before.position[2])
    expect(after.scale).toBe(before.scale)
    expect(after.rotation).toBe(before.rotation)
    expect(after.foot).toBeCloseTo(after.floor,5)
    // A shorter or taller cabinet moves its base and the basket together.
    // Its height may change after removal; the basket must not float or sink.
    expect(after.position[1] - before.position[1]).toBeCloseTo(after.floor - before.floor,5)
  }
  const initialPose = await readGroundPose()
  await expect(page.locator(`.ihr-spine[data-book-id="${seed.originalId}"]`)).toBeInViewport()
  await expect(page.locator('.ihr-spine[data-book-id="trash:long:17"]')).toBeInViewport()
  const scrollBounds = await scroller.boundingBox()
  await page.mouse.move(scrollBounds.x + 8,scrollBounds.y + scrollBounds.height * .5)
  await page.mouse.wheel(0,700)
  await page.waitForTimeout(150)
  await assertCabinetOverview(page)
  await beginDrag(page,seed.originalId)
  try {
    await finishDropIntoBin(page,seed.originalId,testInfo)
    await assertCabinetOverview(page)
  } catch (error) {
    await testInfo.attach('whole-cabinet-direct-drop-failure-geometry', {
      body:JSON.stringify(await shelfScrollDiagnostics(page),null,2),
      contentType:'application/json'
    })
    await testInfo.attach('whole-cabinet-direct-drop-failure-viewport', {
      body:await page.screenshot(),contentType:'image/png'
    })
    throw error
  }
  const firstRemovalPose = await readGroundPose()
  assertGroundedReflow(initialPose,firstRemovalPose)
  await expect(page.locator('.ihr-spine')).toHaveCount(seed.ids.length - 1)
  await assertBinMesh(page)
  const lastId = 'trash:long:17'
  await expect(page.locator(`.ihr-spine[data-book-id="${lastId}"]`)).toBeVisible()
  await dropIntoBin(page, lastId, testInfo)
  await expect(page.locator('.ihr-spine')).toHaveCount(seed.ids.length - 2)
  await expect(scene).toHaveAttribute('data-shelf-view', 'isometric')
  await expect(scene).toHaveAttribute('data-animating', 'false')
  await assertCabinetOverview(page)
  await assertBinMesh(page)
  const secondRemovalPose = await readGroundPose()
  assertGroundedReflow(firstRemovalPose,secondRemovalPose)
  await page.reload()
  await expect(page.locator('.ihr-spine')).toHaveCount(seed.ids.length - 2)
  await expect(page.locator(`.ihr-spine[data-book-id="${seed.originalId}"]`)).toHaveCount(0)
  await expect(page.locator(`.ihr-spine[data-book-id="${lastId}"]`)).toHaveCount(0)
  await expect(page.locator('.ihr-bookshelf')).toHaveAttribute('data-view-mode', 'isometric')
  await expect(page.locator('.ihr-plant')).toHaveCount(3)
  await assertCabinetOverview(page)
  await assertBinMesh(page)
  assertGroundedReflow(secondRemovalPose,await readGroundPose())
})

test('el giro de cámara encuadra la papelera del suelo sin hacerla aparecer escalada ni alterar su pose local', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  await page.setViewportSize({ width:320,height:844 })
  const errors = []; page.on('pageerror',error => errors.push(error.message))
  await seedShelf(page)
  const scene = page.locator('.ihr-bookshelf-scene')
  await page.evaluate(() => {
    const canvas = document.querySelector('.ihr-bookshelf-scene')
    const motion = window.__trashCameraMotion = { frames:[] }
    const capture = () => motion.frames.push({
      progress:Number(canvas.dataset.viewProgress), position:canvas.dataset.trashLocalPosition,
      scale:Number(canvas.dataset.trashLocalScale), rotation:canvas.dataset.trashLocalRotation,
      foot:Number(canvas.dataset.trashFootY),floor:Number(canvas.dataset.cabinetFloorY),
      inFrame:canvas.dataset.trashCameraInFrame === 'true',targetVisible:canvas.dataset.trashVisible === 'true'
    })
    capture()
    motion.observer = new MutationObserver(capture)
    motion.observer.observe(canvas,{ attributes:true,attributeFilter:['data-view-progress'] })
  })
  await useIsometricShelf(page)
  const motion = await page.evaluate(() => {
    const motion = window.__trashCameraMotion
    motion.observer.disconnect()
    return motion.frames
  })
  expect(motion.length).toBeGreaterThan(3)
  expect(motion.some(frame => frame.progress > 0 && frame.progress < 1)).toBe(true)
  expect(motion[0].inFrame).toBe(false)
  expect(motion.some(frame => frame.inFrame)).toBe(true)
  expect(new Set(motion.map(frame => frame.position)).size).toBe(1)
  for (const frame of motion) {
    expect(frame.position.split(',').map(Number).every(Number.isFinite)).toBe(true)
    expect(frame.scale).toBe(1)
    expect(frame.rotation.split(',').map(Number)).toEqual([0,0,0])
    expect(frame.foot).toBeCloseTo(frame.floor,5)
    if (frame.targetVisible) expect(frame.inFrame).toBe(true)
  }
  await assertCabinetOverview(page)
  await assertBinMesh(page)
  await testInfo.attach('fixed-floor-bin-camera-entry',{ body:JSON.stringify(motion,null,2),contentType:'application/json' })
  await testInfo.attach('floor-bin-isometric-320',{ body:await page.screenshot(),contentType:'image/png' })
  await page.getByRole('button',{ name:'Vista de canto' }).click()
  await expect(scene).toHaveAttribute('data-view-progress','0', { timeout:VIEW_TRANSITION_TIMEOUT })
  await expect(scene).toHaveAttribute('data-animating','false')
  expect(await scene.getAttribute('data-trash-local-position')).toBe(motion[0].position)
  expect(await scene.getAttribute('data-trash-local-scale')).toBe('1.000000')
  await expect(page.locator('.ihr-shelf-trash')).toBeHidden()
  expect(errors).toEqual([])
})
