import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderBookshelf } from '../../src/js/bookshelf.js'

const scene = vi.hoisted(() => ({
  create:vi.fn(), updateLayout:vi.fn(), animateBookToTrash:vi.fn(),
  dispose:vi.fn(), flush:vi.fn(), setTrashHover:vi.fn()
}))
const cover = vi.hoisted(() => ({ analyze:vi.fn() }))
vi.mock('../../src/js/cover-appearance.js', async importOriginal => ({
  ...await importOriginal(), analyzeCoverAppearance:cover.analyze,
  readCoverAspectRatio:vi.fn(async () => null)
}))
vi.mock('../../src/js/book-model.js', () => ({
  getBookRenderer:() => ({}), bookView:() => null, fitCoverImage:vi.fn(), planReadingBookPose:vi.fn()
}))
vi.mock('../../src/js/bookshelf-scene.js', () => ({ createBookshelfScene(layout) {
  scene.create(layout)
  return { ...scene, getInspectionZoom:() => 1 }
} }))

const records = () => [
  { id:'render:a', title:'Primero', format:'PDF', sourceType:'local' },
  { id:'render:b', title:'Segundo', format:'PDF', sourceType:'local' }
]
const changedRecords = () => [
  { ...records()[0], title:'Primero actualizado' },
  { ...records()[1], title:'Segundo actualizado' },
  { id:'render:c', title:'Añadido durante retirada', format:'PDF', sourceType:'local' }
]
let container, shelf, width, observerCallback, finishMotion, frames, frameSerial
const originalFonts = Object.getOwnPropertyDescriptor(document, 'fonts')
const spine = id => container.querySelector(`.ihr-spine[data-book-id="${id}"]`)
const settle = async () => { await vi.advanceTimersByTimeAsync(0) }

function mount(onBookRemove = vi.fn(), books = records()) {
  shelf = renderBookshelf(container, books, { sections:false, viewMode:'isometric', onBookRemove })
  expect(scene.create).toHaveBeenCalledOnce()
  expect(scene.updateLayout).not.toHaveBeenCalled()
  return shelf
}
function resize(nextWidth) { width = nextWidth; observerCallback() }
function flushFrame() {
  const scheduled = [...frames.entries()]
  for (const [id, callback] of scheduled) {
    if (!frames.delete(id)) continue
    callback(performance.now())
  }
}
function removeBook() {
  spine('render:a').dispatchEvent(new KeyboardEvent('keydown', {
    key:'Delete', bubbles:true, cancelable:true
  }))
  expect(finishMotion).toBeTypeOf('function')
  expect(shelf.element.classList.contains('is-discarding')).toBe(true)
}
async function land() { finishMotion(true); await settle() }
function expectUpdatedBooks(ids) {
  expect([...container.querySelectorAll('.ihr-spine')].map(node => node.dataset.bookId).sort()).toEqual(ids.sort())
  expect(scene.create).toHaveBeenCalledOnce()
}

beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); localStorage.clear()
  cover.analyze.mockReset().mockResolvedValue(null)
  localStorage.setItem('inhouse-read-shelf-plants', '[]')
  vi.stubGlobal('WebGLRenderingContext', function WebGLRenderingContext() {})
  frames = new Map(); frameSerial = 0; finishMotion = null; width = 390
  vi.stubGlobal('requestAnimationFrame', callback => {
    const id = ++frameSerial; frames.set(id, callback); return id
  })
  vi.stubGlobal('cancelAnimationFrame', id => frames.delete(id))
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback) { observerCallback = callback }
    observe() {}
    disconnect() {}
  })
  // Font readiness is independent of the render requests exercised below.
  Object.defineProperty(document, 'fonts', { configurable:true, value:{ ready:new Promise(() => {}) } })
  scene.animateBookToTrash.mockImplementation(() => ({
    finished:new Promise(resolve => { finishMotion = resolve }),
    cancel() { finishMotion(false) }
  }))
  container = document.createElement('div')
  Object.defineProperty(container, 'clientWidth', { configurable:true, get:() => width })
  document.body.append(container)
})
afterEach(() => {
  shelf?.destroy(); shelf = null; container.remove()
  vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks()
  if (originalFonts) Object.defineProperty(document, 'fonts', originalFonts)
  else delete document.fonts
})

describe('bookshelf render request consumption', () => {
  it('a successful direct refresh consumes its previously scheduled animation frame', () => {
    mount()
    resize(420)
    expect(frames.size).toBe(1)
    shelf.refresh(changedRecords())
    expectUpdatedBooks(['render:a', 'render:b', 'render:c'])
    expect(scene.updateLayout).toHaveBeenCalledOnce()
    expect(frames.size).toBe(0)
    flushFrame()
    expect(scene.updateLayout).toHaveBeenCalledOnce()
  })

  it('the landing render consumes a request whose earlier frame ran while the shelf was busy', async () => {
    mount()
    resize(420)
    removeBook()
    flushFrame()
    expect(scene.updateLayout).not.toHaveBeenCalled()
    await land()
    expectUpdatedBooks(['render:b'])
    expect(scene.updateLayout).toHaveBeenCalledOnce()
    expect(frames.size).toBe(0)
    flushFrame()
    expect(scene.updateLayout).toHaveBeenCalledOnce()
  })

  it('applies the latest queued records and the removal in one layout without resurrecting the removed book', async () => {
    mount()
    removeBook()
    shelf.update(records().map(book => ({ ...book, title:'Cambio anterior' })))
    shelf.update(changedRecords())
    expect(scene.updateLayout).not.toHaveBeenCalled()
    await land()
    expectUpdatedBooks(['render:b', 'render:c'])
    expect(spine('render:b').getAttribute('aria-label')).toContain('Segundo actualizado')
    expect(scene.updateLayout).toHaveBeenCalledOnce()
    flushFrame()
    expect(scene.updateLayout).toHaveBeenCalledOnce()
  })

  it('consumes an appearance update completed during the fall in the landing layout', async () => {
    let finishAnalysis
    cover.analyze.mockImplementation(() => new Promise(resolve => { finishAnalysis = resolve }))
    mount(vi.fn(), records().map(book => book.id === 'render:b' ? { ...book, cover:'fixture://cover' } : book))
    await settle()
    expect(finishAnalysis).toBeTypeOf('function')
    removeBook()
    finishAnalysis({ color:'#2f6b4f', shade:'#244f3c', ink:'#fffaf0', aspectRatio:0.82, source:'cover' })
    await settle()
    expect(scene.updateLayout).not.toHaveBeenCalled()
    await land()
    expectUpdatedBooks(['render:b'])
    expect(spine('render:b').style.getPropertyValue('--ihr-spine-base')).toBe('#2f6b4f')
    expect(scene.updateLayout).toHaveBeenCalledOnce()
    expect(frames.size).toBe(0)
    flushFrame()
    expect(scene.updateLayout).toHaveBeenCalledOnce()
  })

  it('keeps blocked render and record requests until a zero-width shelf becomes visible', async () => {
    mount()
    removeBook()
    shelf.update(changedRecords())
    resize(0)
    await land()
    expect(scene.updateLayout).not.toHaveBeenCalled()
    // The hidden shelf retains its painted origin until layout is possible.
    expect(spine('render:a')).not.toBeNull()
    flushFrame()
    expect(scene.updateLayout).not.toHaveBeenCalled()
    resize(420)
    flushFrame()
    expectUpdatedBooks(['render:b', 'render:c'])
    expect(spine('render:b').getAttribute('aria-label')).toContain('Segundo actualizado')
    expect(scene.updateLayout).toHaveBeenCalledOnce()
    expect(frames.size).toBe(0)
  })

  it('preserves a later storage rollback as a genuine new layout with the latest other records', async () => {
    let rejectStorage
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    mount(() => new Promise((_resolve, reject) => { rejectStorage = reject }))
    removeBook()
    shelf.update(changedRecords())
    await land()
    expectUpdatedBooks(['render:b', 'render:c'])
    expect(scene.updateLayout).toHaveBeenCalledOnce()
    rejectStorage(new Error('Storage unavailable'))
    await settle()
    expectUpdatedBooks(['render:a', 'render:b', 'render:c'])
    expect(spine('render:b').getAttribute('aria-label')).toContain('Segundo actualizado')
    expect(scene.updateLayout).toHaveBeenCalledTimes(2)
    expect(container.querySelector('.ihr-trash-status').textContent).toContain('No se pudo retirar el libro')
    expect(frames.size).toBe(0)
  })

  it('does not lose a rollback or queued record update while the shelf has no measurable width', async () => {
    let rejectStorage
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    mount(() => new Promise((_resolve, reject) => { rejectStorage = reject }))
    removeBook()
    shelf.update(changedRecords())
    resize(0)
    await land()
    rejectStorage(new Error('Storage unavailable'))
    await settle()
    expect(scene.updateLayout).not.toHaveBeenCalled()
    resize(420)
    flushFrame()
    expectUpdatedBooks(['render:a', 'render:b', 'render:c'])
    expect(spine('render:b').getAttribute('aria-label')).toContain('Segundo actualizado')
    expect(scene.updateLayout).toHaveBeenCalledOnce()
    expect(container.querySelector('.ihr-trash-status').textContent).toContain('No se pudo retirar el libro')
  })

  it('still paints a new request that arrives after the previous successful render', () => {
    mount()
    resize(420)
    shelf.refresh(changedRecords())
    expect(scene.updateLayout).toHaveBeenCalledOnce()
    resize(450)
    expect(frames.size).toBe(1)
    flushFrame()
    expect(scene.updateLayout).toHaveBeenCalledTimes(2)
    expect(scene.updateLayout.mock.calls[1][0].width).toBe(450)
    expectUpdatedBooks(['render:a', 'render:b', 'render:c'])
  })
})
