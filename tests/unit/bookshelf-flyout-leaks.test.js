/**
 * The lifted book and its editor live in the shelf module: opening, editing and closing a book over and over
 * must give back every JavaScript handle and every timer the module took (compiled counters, no estimates).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderBookshelf } from '../../src/js/bookshelf.js'
import { rustShelf } from './helpers/rust-shelf-ready.js'
import { click, fire, heldMotion, keydown, q, qa, recordingView, setValue, stubRects } from './helpers/shelf-differential.js'

const state = vi.hoisted(() => ({ log: [], noView: false, hold: false }))
vi.mock('../../src/js/book-model.js', async () => {
  const helper = await import('./helpers/shelf-differential.js')
  return {
    getBookRenderer: () => null,
    planReadingBookPose: () => ({ x: 0, y: 0, scale: 1, angle: 0, pitch: 0, coverOpen: 1 }),
    fitCoverImage: (w, h) => ({ x: 0, y: 0, width: w, height: h }),
    bookView: (host, book, style, dimensions) => {
      if (state.noView) return null
      const view = helper.recordingView(state.log, host, book, style, dimensions)
      for (const method of ['animate', 'animateBookmark', 'animateCoverClose']) {
        const instant = view[method]
        view[method] = (...args) => { const motion = instant(...args); return state.hold ? helper.heldMotion(state.log, `view.${method}`) : motion }
      }
      return view
    }
  }
})
vi.mock('../../src/js/cover-relief.js', async importOriginal => ({
  ...await importOriginal(), buildReliefMaps: vi.fn(),
  analyzeCoverRelief: vi.fn(async () => ({ proposals: [{ id: 'c1', color: '#d4a93c', tolerance: 5, label: 'Color', description: 'x', strength: 0.5, thumbnail: '' }] }))
}))
vi.mock('../../src/js/cover-appearance.js', async importOriginal => ({ ...await importOriginal(), readCoverAspectRatio: vi.fn(async () => 0.66), analyzeCoverAppearance: vi.fn(async () => null) }))

let shelf, container, restoreRects
beforeEach(() => {
  state.log.length = 0; state.noView = false; state.hold = false
  restoreRects = stubRects()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({ drawImage() {} }))
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'Date'] })
  vi.stubGlobal('matchMedia', query => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }))
})
afterEach(() => { shelf?.destroy(); shelf = null; container?.remove(); document.body.innerHTML = ''; restoreRects(); vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals() })

async function cycle(edit) {
  q('.ihr-spine').click()
  await vi.waitFor(() => expect(q('.ihr-flyout__cover-target.is-ready')).not.toBeNull())
  if (edit) {
    click(q('.ihr-flyout__edit-button'))
    setValue(q('[aria-label="Fuente del lomo"]'), 'Lora', 'change')
    click(qa('.ihr-flyout__swatch')[1])
    click(qa('[role="tab"]').find(tab => tab.textContent === 'Portada'))
    await vi.advanceTimersByTimeAsync(400)
    const input = qa('.ihr-relief__input')[0]
    if (input) { input.checked = true; fire(input, 'change') }
    await vi.advanceTimersByTimeAsync(400)
  }
  keydown(document.body, 'Escape')
  if (edit) keydown(document.body, 'Escape')
  await vi.advanceTimersByTimeAsync(1000)
  await vi.waitFor(() => expect(q('.ihr-flyout')).toBeNull())
}

async function readerCycle() {
  q('.ihr-spine').click()
  await vi.waitFor(() => expect(q('.ihr-flyout__cover-target.is-ready')).not.toBeNull())
  click(q('.ihr-flyout__cover-target'))
  await vi.advanceTimersByTimeAsync(300)
  await vi.waitFor(() => expect(q('.ihr-flyout')).toBeNull())
}

describe('the lifted book in the shelf module', () => {
  it('gives back every handle and callback after many open, edit and close cycles', async () => {
    container = document.createElement('div'); document.body.append(container)
    shelf = renderBookshelf(container, [{ id: 'leak', title: 'Libro', author: 'Autor', format: 'EPUB', progressFraction: 0.2, cover: new Blob(['x']) }],
      { shelfWidth: 390, sections: false, revealDuration: 0, holdMs: 0, coverSrcFor: () => 'blob:x', onBookCustomizationChange: async () => {}, getBookPreparation: () => Promise.resolve(true) })
    await vi.advanceTimersByTimeAsync(50)
    for (let index = 0; index < 3; index++) await cycle(index % 2 === 1)
    const handles = rustShelf.shelf_live_handles()
    const callbacks = rustShelf.shelf_pending_callbacks()
    for (let index = 0; index < 20; index++) await cycle(index % 2 === 0)
    await vi.advanceTimersByTimeAsync(2000)
    expect(rustShelf.shelf_live_handles()).toBe(handles)
    expect(rustShelf.shelf_pending_callbacks()).toBe(callbacks)
  }, 60_000)

  it('gives back every handle when the book is handed to the reader over and over', async () => {
    container = document.createElement('div'); document.body.append(container)
    const onOpenBook = async (_book, context) => context.finish({
      pageSnapshot: { source: document.createElement('canvas'), paper: { source: document.createElement('canvas') }, width: 374, height: 561, location: { fraction: 0.4, locator: { kind: 'pdf-page', value: 3 } } },
      animatePage: async ({ duration, animateBookToPage }) => { await animateBookToPage({ left: 8, top: 48, width: 374, height: 561, duration }) }
    })
    shelf = renderBookshelf(container, [{ id: 'leak', title: 'Libro', author: 'Autor', format: 'PDF', progressFraction: 0.2, cover: new Blob(['x']) }],
      { shelfWidth: 390, sections: false, revealDuration: 0, holdMs: 0, coverSrcFor: () => 'blob:x', onOpenBook })
    await vi.advanceTimersByTimeAsync(50)
    for (let index = 0; index < 3; index++) await readerCycle()
    await vi.advanceTimersByTimeAsync(2000)
    const handles = rustShelf.shelf_live_handles()
    const callbacks = rustShelf.shelf_pending_callbacks()
    for (let index = 0; index < 15; index++) await readerCycle()
    await vi.advanceTimersByTimeAsync(2000)
    expect(rustShelf.shelf_live_handles()).toBe(handles)
    expect(rustShelf.shelf_pending_callbacks()).toBe(callbacks)
  }, 60_000)

  it('gives back every handle and callback when the book comes back from the reader over and over', async () => {
    container = document.createElement('div'); document.body.append(container)
    const snapshot = () => ({ source: document.createElement('canvas'), paper: { source: document.createElement('canvas') }, width: 374, height: 561, displayBounds: { left: 8, top: 48, width: 374, height: 561 },
      location: { fraction: 0.4, locator: { kind: 'pdf-page', value: 3 } } })
    const onOpenBook = async (_book, context) => context.finish({ pageSnapshot: snapshot(), animatePage: async ({ duration, animateBookToPage }) => { await animateBookToPage({ left: 8, top: 48, width: 374, height: 561, duration }) } })
    const record = { id: 'leak', title: 'Libro', author: 'Autor', format: 'PDF', progressFraction: 0.2, cover: new Blob(['x']) }
    shelf = renderBookshelf(container, [record], { shelfWidth: 390, sections: false, revealDuration: 0, holdMs: 0, coverSrcFor: () => 'blob:x', onOpenBook })
    await vi.advanceTimersByTimeAsync(50)
    const back = async (withPage = true) => {
      shelf.setReturningBook('leak')
      await shelf.returnToShelf('leak', { pageSnapshot: withPage ? snapshot() : undefined, book: { ...record, progressFraction: 0.5 }, onPageReady() {} })
    }
    // 3D view, the DOM book, no saved page, and a return that is replaced while its motions are held.
    const cycle = async index => {
      state.noView = index % 3 === 1
      await readerCycle()
      if (index % 4 === 3) {
        state.hold = true
        shelf.setReturningBook('leak')
        shelf.returnToShelf('leak', { pageSnapshot: snapshot() }).catch(() => {})
        await vi.advanceTimersByTimeAsync(50)
        state.hold = false
        await back()
        await vi.advanceTimersByTimeAsync(20_000)
      } else await back(index % 2 === 0)
      await vi.advanceTimersByTimeAsync(300)
    }
    for (let index = 0; index < 4; index++) await cycle(index)
    await vi.advanceTimersByTimeAsync(2000)
    const handles = rustShelf.shelf_live_handles()
    const callbacks = rustShelf.shelf_pending_callbacks()
    for (let index = 0; index < 16; index++) await cycle(index)
    await vi.advanceTimersByTimeAsync(20_000)
    expect(rustShelf.shelf_live_handles()).toBe(handles)
    expect(rustShelf.shelf_pending_callbacks()).toBe(callbacks)
  }, 90_000)
})
