/**
 * Moving things around the shelf lives in the shelf module: dragging, dropping, switching, adding, removing and
 * re-analysing covers over and over must give back every JavaScript handle and every timer or frame the module took
 * (compiled counters, no estimates), including when the work is cut short.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderBookshelf } from '../../src/js/bookshelf.js'
import { rustShelf } from './helpers/rust-shelf-ready.js'
import { flush, keydown, qa, recordingScene, recordingView, stubRects } from './helpers/shelf-differential.js'
import { LAMP_CATALOG } from '../../src/js/lamp-catalog-data.js'
import { PLANT_CATALOG, POT_CATALOG } from '../../src/js/plant-catalog-data.js'

const state = vi.hoisted(() => ({ log: [], catalog: null, hit: null, analyses: 0 }))
vi.mock('../../src/js/book-model.js', async () => {
  const helper = await import('./helpers/shelf-differential.js')
  return {
    getBookRenderer: () => ({}),
    planReadingBookPose: () => ({ x: 0, y: 0, scale: 1, angle: 0, pitch: 0, coverOpen: 1 }),
    fitCoverImage: (w, h) => ({ x: 0, y: 0, width: w, height: h }),
    bookView: (host, book, style, dimensions) => helper.recordingView(state.log, host, book, style, dimensions)
  }
})
vi.mock('../../src/js/bookshelf-scene.js', async () => {
  const helper = await import('./helpers/shelf-differential.js')
  const answers = { getObjectAtPoint: () => state.hit, getBookAtPoint: () => state.hit, getDropPosition: () => ({ shelf: 1, x: 0.4 }), getInspectionZoom: () => 1,
    animateObjectToTrash: () => ({ finished: new Promise(resolve => setTimeout(() => resolve(true), 200)), cancel() {} }) }
  return { createBookshelfScene: () => helper.recordingScene([], { answers }) }
})
vi.mock('../../src/js/plant-catalog-lazy.js', () => ({
  createLazyPlantCatalog: options => { state.catalog = options; return { prefetch() {}, prepare() {}, open() {}, setShelfType() {}, destroy() {}, close() {} } }
}))
vi.mock('../../src/js/cover-relief.js', async importOriginal => ({ ...await importOriginal(), buildReliefMaps: vi.fn(), analyzeCoverRelief: vi.fn(async () => ({ proposals: [] })) }))
vi.mock('../../src/js/cover-appearance.js', async importOriginal => ({
  ...await importOriginal(), readCoverAspectRatio: vi.fn(async () => 0.66),
  analyzeCoverAppearance: vi.fn(async () => ({ color: '#2a6f97', shade: '#1d4f6f', ink: '#f3f1e2', fontFamily: 'Lora', fontCanvasFamily: 'Lora', fontFallback: 'Georgia, serif', fontWeight: 600, aspectRatio: 0.5 + (++state.analyses % 7) / 20, source: 'cover' }))
}))

const PLANT = PLANT_CATALOG[0], POT = POT_CATALOG[0], LAMP = LAMP_CATALOG[0]
let shelf, container, restoreRects, urls
beforeEach(() => {
  state.log.length = 0; state.hit = null; state.analyses = 0; urls = 0
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'Date'] })
  localStorage.clear()
  restoreRects = stubRects({ layout: true })
  vi.stubGlobal('WebGLRenderingContext', class {})
  vi.stubGlobal('matchMedia', query => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }))
  globalThis.URL.createObjectURL = () => `blob:leak/${++urls}`
  globalThis.URL.revokeObjectURL = () => {}
})
afterEach(() => {
  shelf?.destroy(); shelf = null; container?.remove(); document.body.innerHTML = ''
  restoreRects(); delete globalThis.URL.createObjectURL; delete globalThis.URL.revokeObjectURL
  vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals()
})

const pointer = (node, type, init = {}) => {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.assign(event, { button: 0, pointerId: 1, pointerType: 'mouse', isPrimary: true, clientX: 30, clientY: 120, detail: 0, ...init })
  node.dispatchEvent(event)
}
const records = revision => [0, 1, 2].map(index => ({ id: `leak-${index}`, title: `Libro ${index}`, format: 'PDF', cover: new Blob(['x'.repeat(index + 1 + revision % 2)]) }))

async function cycle(index) {
  await state.catalog.onAdd({ catalogId: PLANT.id, potId: POT.id }, { whenClosed: run => run() })
  await state.catalog.onAddLamp({ lampId: LAMP.id }, { whenClosed: run => run() })
  await flush(700)
  // A book is held, dragged to another place and dropped.
  const book = qa('.ihr-spine')[0]
  state.hit = book
  pointer(book, 'pointerdown'); await flush(500); pointer(book, 'pointermove', { clientX: 120, clientY: 220 }); await flush(40); pointer(book, 'pointerup', { clientX: 120, clientY: 220 })
  await flush(900)
  // The plant moves with the keyboard and the lamp is switched.
  keydown(qa('.ihr-plant')[0], 'ArrowRight', { shiftKey: true }); await flush(700)
  qa('.ihr-lamp')[0].click(); await flush(100)
  // A drag that is cut short, then both objects leave through the bin (one by the keyboard).
  const lamp = qa('.ihr-lamp')[0]
  state.hit = lamp
  pointer(lamp, 'pointerdown'); await flush(500); pointer(lamp, 'pointermove', { clientX: 90, clientY: 180 }); await flush(40)
  if (index % 2) window.dispatchEvent(new Event('resize'))
  else pointer(lamp, 'pointercancel')
  await flush(900)
  for (const node of [qa('.ihr-plant')[0], qa('.ihr-lamp')[0]]) { if (node) keydown(node, 'Delete'); await flush(1200) }
  // The records arrive again with other covers: new analyses, new object URLs.
  shelf.refresh(records(index)); await flush(300)
  // A press that is released, which preloads a cover.
  const spine = qa('.ihr-spine')[1]
  pointer(spine, 'pointerdown', { pointerType: 'touch' }); await flush(50); pointer(spine, 'pointerup', { pointerType: 'touch' }); await flush(300)
  keydown(document.body, 'Escape'); await flush(1200)
}

describe('moving things on the shelf', () => {
  it('gives back every handle and callback after many drags, drops, switches, additions, removals and cover analyses', async () => {
    container = document.createElement('div'); document.body.append(container)
    shelf = renderBookshelf(container, records(0), { shelfWidth: 390, sections: false, revealDuration: 0, holdMs: 0, viewMode: 'isometric',
      coverSrcFor: () => null, onBookRemove: async () => {}, onBookOrderChange: async () => {}, onShelfPlacementChange: async () => {}, onPrepareBook: async () => {} })
    await flush(50)
    for (let index = 0; index < 4; index++) await cycle(index)
    await flush(5000)
    const handles = rustShelf.shelf_live_handles()
    const callbacks = rustShelf.shelf_pending_callbacks()
    for (let index = 0; index < 14; index++) await cycle(index)
    await flush(5000)
    expect(rustShelf.shelf_live_handles()).toBe(handles)
    expect(rustShelf.shelf_pending_callbacks()).toBe(callbacks)
  }, 120_000)

  it('gives back everything the shelf took when it is destroyed in the middle of a drag, a removal and an analysis', async () => {
    container = document.createElement('div'); document.body.append(container)
    const before = rustShelf.shelf_live_handles(), callbacksBefore = rustShelf.shelf_pending_callbacks()
    for (let round = 0; round < 6; round++) {
      shelf = renderBookshelf(container, records(round), { shelfWidth: 390, sections: false, revealDuration: 0, holdMs: 0, viewMode: 'isometric',
        onBookRemove: async () => {}, coverSrcFor: () => null })
      await flush(50)
      await state.catalog.onAdd({ catalogId: PLANT.id, potId: POT.id }, { whenClosed: run => run() })
      await flush(700)
      const plant = qa('.ihr-plant')[0]
      state.hit = plant
      pointer(plant, 'pointerdown'); await flush(500); pointer(plant, 'pointermove', { clientX: 90, clientY: 180 }); await flush(40)
      keydown(qa('.ihr-spine')[0], 'Delete'); await flush(50)
      shelf.destroy(); shelf = null
      container.replaceChildren()
      await flush(3000)
    }
    expect(rustShelf.shelf_live_handles()).toBe(before)
    expect(rustShelf.shelf_pending_callbacks()).toBe(callbacksBefore)
  }, 120_000)
})
