import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { spinePointerPosition } from './helpers/shelf-pointer.mjs'
import { settledGeometryLength } from './helpers/settled-geometry-length.mjs'

const BOOK_ID = 'native-legacy-return:tiny-real-pdf'

test.use({ viewport:{ width:393, height:844 }, deviceScaleFactor:2.75, isMobile:true, hasTouch:true })

test('el regreso nativo conserva la sala fraccional a 393px con el framebuffer original y exportaciones 2D bajo demanda', async ({ page }) => {
  await page.emulateMedia({ reducedMotion:'no-preference' })
  const bytes = [...await readFile('tests/e2e/fixtures/tiny.pdf')]
  await page.addInitScript(({ bytes, id, geometry }) => {
    const image = document.createElement('canvas')
    // This real one-page fixture has a 300 × 200 page and four actual words.
    // Match that ratio and measured length to avoid synthetic geometry changes.
    image.width = 600; image.height = 400
    const context = image.getContext('2d')
    context.fillStyle = '#41695d'; context.fillRect(0, 0, 600, 400)
    context.fillStyle = '#e3bc78'; context.fillRect(0, 250, 600, 150)
    context.fillStyle = '#fffaf0'; context.font = 'bold 40px Georgia'
    context.fillText('Inhouse Read test PDF', 30, 110)
    // Encode the same fixture pixels before IndexedDB opens. This keeps the
    // initial upgrade synchronous, so production's first read waits for the book.
    const encoded = atob(image.toDataURL('image/png').split(',')[1])
    const cover = new Blob([Uint8Array.from(encoded, value => value.charCodeAt(0))], { type:'image/png' })
    const title = 'Inhouse Read test PDF'
    const record = {
      id, title, author:'Autora de prueba', name:'tiny.pdf', ...geometry,
      format:'PDF', mimeType:'application/pdf', sourceType:'local',
      content:new Blob([new Uint8Array(bytes)], { type:'application/pdf' }),
      cover, pageCount:1, shelfOrder:0, addedAt:Date.now(), progressFraction:0,
      coverAppearance:{ color:'#41695d', shade:'#2b463d', ink:'#fffaf0',
        aspectRatio:1.5, fontFamily:'Lora', fontCanvasFamily:'Lora', source:'cover' },
      coverAppearanceKey:`${id}|${title}|${cover.type}|${cover.size}|`,
      spineColorOverride:'#41695d'
    }
    window.__nativeShelfFixtureReady = new Promise((resolve, reject) => {
      // Use the real v2 schema before the app opens the database. The fixture
      // put is part of the upgrade transaction; no empty room/reload is needed.
      const request = indexedDB.open('inhouse-read', 2)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains('books')) {
          const store = db.createObjectStore('books', { keyPath:'id' })
          store.createIndex('lastOpenedAt', 'lastOpenedAt')
        }
        if (!db.objectStoreNames.contains('removed-books')) db.createObjectStore('removed-books', { keyPath:'id' })
        request.transaction.objectStore('books').put(record)
      }
      request.onerror = () => reject(request.error)
      request.onblocked = () => reject(new Error('Native shelf fixture database upgrade was blocked'))
      request.onsuccess = () => {
        const db = request.result
        db.onversionchange = () => db.close()
        const read = db.transaction('books', 'readonly').objectStore('books').get(id)
        read.onerror = () => { db.close(); reject(read.error) }
        read.onsuccess = () => {
          const saved = read.result
          db.close()
          if (!saved || saved.id !== id || saved.content?.size !== bytes.length || saved.cover?.size !== cover.size) {
            reject(new Error('Native shelf fixture was not committed before the app started'))
          } else resolve()
        }
      }
    })
  }, { bytes, id:BOOK_ID, geometry:settledGeometryLength(4, BOOK_ID) })
  await page.goto(process.env.IHR_TEST_URL || '/')
  await page.evaluate(() => window.__nativeShelfFixtureReady)
  const spine = page.locator(`.ihr-spine[data-book-id="${BOOK_ID}"]`)
  await expect(spine).toBeVisible()
  const initialRoom = await page.evaluate(() => {
    const shelf = document.querySelector('.ihr-bookshelf-scene')
    const room = document.querySelector('.ihr-bookshelf-native-room-canvas'), gl = room?.getContext('webgl2')
    const rect = room?.getBoundingClientRect()
    return { mode:shelf?.dataset.nativeRoomPresentation, opacity:getComputedStyle(shelf).opacity,
      ratio:Number(shelf?.dataset.pixelRatio), realGL:gl instanceof WebGL2RenderingContext, lost:Boolean(gl?.isContextLost()),
      physical:[room?.width, room?.height, gl?.drawingBufferWidth, gl?.drawingBufferHeight],
      rect:rect && [rect.width, rect.height] }
  })
  expect(initialRoom.mode).toBe('true'); expect(initialRoom.opacity).toBe('0')
  expect(initialRoom.ratio).toBe(1.5); expect(initialRoom.realGL).toBe(true); expect(initialRoom.lost).toBe(false)
  expect(initialRoom.rect).toEqual([393, 783])
  expect(initialRoom.physical).toEqual([589, 1174, 589, 1174])
  await test.info().attach('native-fractional-room-before-selection', { body:JSON.stringify(initialRoom), contentType:'application/json' })
  const bounds = await spine.boundingBox()
  expect(bounds).not.toBeNull()
  await spine.click({ position:await spinePointerPosition(spine, bounds) })
  await expect(page.locator('.ihr-flyout__cover-target')).toBeVisible()
  await expect(page.locator('.ihr-flyout__readiness')).toHaveText('Listo para leer')
  await page.locator('.ihr-flyout__cover-target').click()
  await expect(page.locator('.pdf-page-canvas')).toBeVisible()

  // Observe before the real click. No pixel exports, screenshots or GPU readbacks
  // occur on the close clock; they would add the very waits under investigation.
  await page.evaluate(id => {
    const result = { clickedAt:null, endedAt:null, closingSeen:false, samples:[], errors:[] }
    const shelf = document.querySelector('.ihr-bookshelf-scene')
    let insertionNode = null, insertionContext = null, frame = 0, stopped = false
    const painted = node => {
      if (!node?.isConnected) return false
      for (let current = node; current instanceof Element; current = current.parentElement) {
        const style = getComputedStyle(current)
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false
      }
      return true
    }
    const sample = () => {
      if (stopped || result.clickedAt == null) return
      const closing = document.body.classList.contains('is-closing-reader')
      if (closing) result.closingSeen = true
      else if (result.closingSeen && result.endedAt == null) result.endedAt = performance.now()
      const native = document.querySelector('.ihr-shelf-insertion-live-canvas')
      if (!native) return
      const gl = native.getContext('webgl2'), rect = native.getBoundingClientRect()
      const overlay = document.querySelector('.ihr-flyout--return .ihr-book-canvas')
      insertionNode ||= native; insertionContext ||= gl
      const snapshot = {
        progress:Number(shelf?.dataset.returnProgress), closing,
        retainedShelf:document.querySelector('.ihr-bookshelf-scene') === shelf,
        sameNode:native === insertionNode, sameContext:gl === insertionContext,
        realGL:gl instanceof WebGL2RenderingContext, lost:Boolean(gl?.isContextLost()),
        physical:[native.width, native.height, gl?.drawingBufferWidth, gl?.drawingBufferHeight],
        expectedPhysical:[innerWidth * Math.min(devicePixelRatio, 2), innerHeight * Math.min(devicePixelRatio, 2)],
        rect:[rect.left, rect.top, rect.width, rect.height], viewport:[innerWidth, innerHeight],
        legacyRoomVisible:painted(shelf) && getComputedStyle(shelf).opacity === '1',
        legacyRoomMode:shelf?.dataset.nativeRoomPresentation,
        nativeRoomCount:document.querySelectorAll('.ihr-bookshelf-native-room-canvas').length,
        visible:painted(native), exportHidden:Boolean(overlay) && getComputedStyle(overlay).opacity === '0',
        away:document.querySelector(`.ihr-spine[data-book-id="${id}"]`)?.classList.contains('is-away'),
        insertionCount:document.querySelectorAll('.ihr-shelf-insertion-live-canvas').length,
        oldBookCount:document.querySelectorAll('.ihr-flyout--return .ihr-book-live-canvas').length
      }
      if (result.samples.length < 100 && !result.samples.some(value => value.progress === snapshot.progress)) result.samples.push(snapshot)
    }
    const observer = new MutationObserver(sample)
    observer.observe(document.body, { subtree:true, childList:true, attributes:true,
      attributeFilter:['class', 'data-return-progress'] })
    const tick = () => { sample(); if (!stopped) frame = requestAnimationFrame(tick) }
    frame = requestAnimationFrame(tick)
    const click = event => {
      if (event.target.closest?.('#reader-back') && result.clickedAt == null) result.clickedAt = performance.now()
    }
    document.addEventListener('click', click, true)
    window.__nativeShelfReturn = {
      result,
      finish() {
        sample(); stopped = true; cancelAnimationFrame(frame); observer.disconnect()
        document.removeEventListener('click', click, true)
        return { ...result, final:{
          roomCount:document.querySelectorAll('.ihr-bookshelf-native-room-canvas').length,
          insertionCount:document.querySelectorAll('.ihr-shelf-insertion-live-canvas').length,
          bookCount:document.querySelectorAll('.ihr-book-live-canvas').length,
          flyoutCount:document.querySelectorAll('.ihr-flyout').length,
          returningPageCount:document.querySelectorAll('.ihr-reader-return-page').length,
          sameRoomNode:document.querySelector('.ihr-bookshelf-native-room-canvas') === insertionNode,
          sameRoomContext:document.querySelector('.ihr-bookshelf-native-room-canvas')?.getContext('webgl2') === insertionContext,
          roomPhysical:[insertionNode?.width, insertionNode?.height, insertionContext?.drawingBufferWidth, insertionContext?.drawingBufferHeight],
          roomLost:Boolean(insertionContext?.isContextLost()),
          visible:painted(document.querySelector('.ihr-bookshelf-native-room-canvas')),retainedShelf:document.querySelector('.ihr-bookshelf-scene') === shelf,
          legacyRoomMode:shelf?.dataset.nativeRoomPresentation,
          opacity:getComputedStyle(shelf).opacity,pixelRatio:Number(shelf?.dataset.pixelRatio),
          away:document.querySelector(`.ihr-spine[data-book-id="${id}"]`)?.classList.contains('is-away')
        } }
      }
    }
  }, BOOK_ID)
  await page.locator('#reader-back').click()
  await expect(page.locator('body')).not.toHaveClass(/is-closing-reader/)
  await expect(page.locator('.ihr-flyout')).toHaveCount(0)
  const facts = await page.evaluate(() => window.__nativeShelfReturn.finish())
  await test.info().attach('native-legacy-shelf-return-contract', { body:JSON.stringify(facts), contentType:'application/json' })

  expect(facts.closingSeen).toBe(true)
  expect(facts.clickedAt).not.toBeNull(); expect(facts.endedAt).not.toBeNull()
  expect(facts.endedAt - facts.clickedAt).toBeLessThanOrEqual(8_000)
  expect(facts.samples.length).toBeGreaterThan(0)
  for (const sample of facts.samples) {
    expect(sample.realGL).toBe(true); expect(sample.lost).toBe(false)
    expect(sample.sameNode && sample.sameContext && sample.retainedShelf).toBe(true)
    expect(sample.physical).toEqual([...sample.expectedPhysical, ...sample.expectedPhysical])
    expect(sample.rect).toEqual([0, 0, ...sample.viewport])
    expect(sample.visible && sample.exportHidden && sample.away && sample.closing).toBe(true)
    expect(sample.legacyRoomVisible).toBe(false); expect(sample.legacyRoomMode).toBe('true')
    expect(sample.nativeRoomCount).toBe(0)
    expect(sample.insertionCount).toBe(1); expect(sample.oldBookCount).toBe(0)
    expect(sample.progress).toBeGreaterThanOrEqual(0); expect(sample.progress).toBeLessThanOrEqual(1)
  }
  expect(facts.final.roomCount).toBe(1)
  expect(facts.final.insertionCount).toBe(0); expect(facts.final.bookCount).toBe(0)
  expect(facts.final.flyoutCount).toBe(0); expect(facts.final.returningPageCount).toBe(0)
  expect(facts.final.sameRoomNode && facts.final.sameRoomContext && facts.final.visible && facts.final.retainedShelf).toBe(true)
  expect(facts.final.roomPhysical).toEqual([589, 1174, 589, 1174]); expect(facts.final.roomLost).toBe(false)
  expect(facts.final.legacyRoomMode).toBe('true'); expect(facts.final.opacity).toBe('0')
  expect(facts.final.pixelRatio).toBe(1.5); expect(facts.final.away).toBe(false)

  // Pixel exports happen only after the unchanged eight-second close budget.
  // Materializing the original 2D export must leave the native room unchanged.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const beforeExport = await page.screenshot()
  const exportFacts = await page.evaluate(() => {
    const shelf = document.querySelector('.ihr-bookshelf-scene')
    const room = document.querySelector('.ihr-bookshelf-native-room-canvas')
    const exported = shelf.getContext('2d').getImageData(0, 0, shelf.width, shelf.height).data
    let exportedPainted = 0
    for (let index = 3; index < exported.length; index += 4) if (exported[index]) exportedPainted++
    return { exportedPainted, sameShelf:document.querySelector('.ihr-bookshelf-scene') === shelf,
      visible:Boolean(room?.isConnected) && getComputedStyle(room).visibility !== 'hidden' && getComputedStyle(shelf).opacity === '0',
      sameRoom:document.querySelector('.ihr-bookshelf-native-room-canvas') === room,
      exportPhysical:[shelf.width, shelf.height], nativeRoomCount:document.querySelectorAll('.ihr-bookshelf-native-room-canvas').length,
      insertionCount:document.querySelectorAll('.ihr-shelf-insertion-live-canvas').length }
  })
  const afterExport = await page.screenshot()
  await test.info().attach('native-room-before-lazy-export', { body:beforeExport, contentType:'image/png' })
  await test.info().attach('native-room-after-lazy-export', { body:afterExport, contentType:'image/png' })
  await test.info().attach('native-room-lazy-export', { body:JSON.stringify(exportFacts), contentType:'application/json' })
  expect(afterExport.equals(beforeExport)).toBe(true)
  expect(exportFacts.exportedPainted).toBeGreaterThan(0)
  expect(exportFacts.sameShelf && exportFacts.sameRoom && exportFacts.visible).toBe(true)
  expect(exportFacts.exportPhysical).toEqual([590, 1175])
  expect(exportFacts.nativeRoomCount).toBe(1)
  expect(exportFacts.insertionCount).toBe(0)
})
