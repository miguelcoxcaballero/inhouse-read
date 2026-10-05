import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderBookshelf } from '../../src/js/bookshelf.js'

const scene = vi.hoisted(() => ({ native:true, flush:vi.fn(), getBookAtPoint:vi.fn(), getObjectAtPoint:vi.fn() }))
vi.mock('../../src/js/book-model.js', () => ({ getBookRenderer:() => scene.native ? {} : null, bookView:() => null, fitCoverImage:vi.fn(), planReadingBookPose:vi.fn() }))
vi.mock('../../src/js/bookshelf-scene.js', () => ({ createBookshelfScene:() => ({
  ...scene, dispose:vi.fn(), updateLayout:vi.fn(), updateEntry:vi.fn(), flush:scene.flush, getBookPose:() => null,
  getInspectionZoom:() => 1, getInspectionView:() => ({ zoom:1, panX:0, panY:0, width:390, height:844, centerX:195, centerY:422 }),
  setInspectionView:view => view, beginInspectionGesture:vi.fn(),
  setDropPosition:vi.fn(), previewPlacements:vi.fn(), setTrashHover:vi.fn(), getDropPosition:() => null
}) }))

let shelf, container, spine, prepared
function pointer(type, { node = spine, id = 1, pointerType = 'touch', primary = true, x = 90, y = 240 } = {}) {
  const event = new MouseEvent(type, { clientX:x, clientY:y, button:0, bubbles:true, cancelable:true })
  Object.defineProperties(event, { pointerId:{ value:id }, pointerType:{ value:pointerType }, isPrimary:{ value:primary } })
  node.dispatchEvent(event)
}
function mount(native = true, viewMode = 'isometric') {
  shelf?.destroy(); container.replaceChildren(); scene.native = native
  shelf = renderBookshelf(container, [{ id:'touch-book', title:'Libro táctil', format:'PDF' }], {
    shelfWidth:390, viewMode, onPrepareBook:prepared,
    // Hold the real selection before its flyout: assertions observe activation,
    // not renderer timing, and Escape can cancel it before a delayed click.
    coverSrcFor:() => new Promise(() => {})
  })
  spine = container.querySelector('.ihr-spine')
  scene.getBookAtPoint.mockReturnValue(spine)
  scene.getObjectAtPoint.mockReturnValue(spine)
  scene.flush.mockClear()
}
const click = (detail = 1) => spine.dispatchEvent(new MouseEvent('click', { detail, clientX:90, clientY:240, bubbles:true }))
const cancelSelection = () => document.dispatchEvent(new KeyboardEvent('keydown', { key:'Escape', bubbles:true }))
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); localStorage.clear()
  vi.stubGlobal('WebGLRenderingContext', function () {})
  localStorage.setItem('inhouse-read-shelf-plants', '[]')
  container = document.createElement('div'); document.body.append(container)
  prepared = vi.fn()
  mount()
})
afterEach(() => {
  shelf.destroy(); container.remove(); document.body.innerHTML = ''
  vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks()
})


const cleanPending = node => {
  expect(node.classList.contains('is-press-pending')).toBe(false)
  expect(node.classList.contains('is-lifted')).toBe(false)
}
describe('pending native press without a short-tap room lift', () => {
  it.each(['mouse', 'touch'])('keeps the short %s semantic press and original activation without an early flush', pointerType => {
    pointer('pointerdown', { pointerType })
    expect(spine.classList.contains('is-pressed')).toBe(true)
    expect(spine.classList.contains('is-press-pending')).toBe(true)
    expect(scene.flush).not.toHaveBeenCalled()
    pointer('pointerup', { pointerType }); cleanPending(spine)
    expect(spine.classList.contains('is-pressed')).toBe(false)
    if (pointerType === 'mouse') {
      expect(prepared).not.toHaveBeenCalled(); expect(scene.flush).not.toHaveBeenCalled(); click()
    }
    expect(prepared).toHaveBeenCalledOnce()
    expect(prepared.mock.calls[0][0].id).toBe('touch-book')
    if (pointerType === 'touch') { click(); expect(prepared).toHaveBeenCalledOnce() }
  })
  it('preserves the original 440 ms hold and full touch lift', async () => {
    const pointerType = 'touch'
    pointer('pointerdown', { pointerType }); await vi.advanceTimersByTimeAsync(439)
    expect(spine.classList.contains('is-pressed')).toBe(true)
    expect(spine.classList.contains('is-press-pending')).toBe(true)
    expect(spine.classList.contains('is-lifted')).toBe(false)
    expect(scene.flush).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(11)
    expect(spine.classList.contains('is-pressed')).toBe(false)
    expect(spine.classList.contains('is-press-pending')).toBe(false)
    expect(spine.classList.contains('is-lifted')).toBe(true)
    expect(scene.flush).toHaveBeenCalledOnce()
    pointer('pointerup', { pointerType }); cleanPending(spine); click()
    expect(prepared).not.toHaveBeenCalled()
  })
  it.each(['cancel', 'move'])('cleans pending on %s without opening', gesture => {
    pointer('pointerdown')
    if (gesture === 'move') pointer('pointermove', { y:290 })
    pointer(gesture === 'cancel' ? 'pointercancel' : 'pointerup', { y:gesture === 'move' ? 290 : 240 })
    cleanPending(spine); expect(spine.classList.contains('is-pressed')).toBe(false)
    click(); expect(prepared).not.toHaveBeenCalled(); expect(scene.flush).not.toHaveBeenCalled()
    if (gesture === 'cancel') {
      pointer('pointerdown', { id:3 }); pointer('pointerleave', { id:3 }); pointer('pointerup', { id:3 })
      cleanPending(spine); expect(spine.classList.contains('is-pressed')).toBe(false)
      click(); expect(prepared).not.toHaveBeenCalled()
    }
  })
  it('cleans pending when the second finger converts the touch to navigation', () => {
    pointer('pointerdown'); pointer('pointerdown', { id:2, primary:false, x:150 })
    pointer('pointerup', { id:2, primary:false, x:150 }); pointer('pointerup')
    cleanPending(spine); expect(spine.classList.contains('is-pressed')).toBe(false)
    click(); expect(prepared).not.toHaveBeenCalled()
  })
  it('preserves the original 2D pressed feedback without a native pending mark', () => {
    mount(false); pointer('pointerdown')
    expect(spine.classList.contains('is-pressed')).toBe(true)
    expect(spine.classList.contains('is-press-pending')).toBe(false)
    pointer('pointerup'); cleanPending(spine); expect(prepared).toHaveBeenCalledOnce()
  })
  it('cleans the original button when the 3D ray retargets its hold', () => {
    const neighbor = document.createElement('button'); neighbor.className = 'ihr-spine'
    neighbor.dataset.bookId = 'neighbor'; container.querySelector('.ihr-shelf-stage').append(neighbor)
    scene.getObjectAtPoint.mockReturnValue(neighbor); pointer('pointerdown')
    expect(spine.classList.contains('is-pressed')).toBe(false)
    expect(spine.classList.contains('is-press-pending')).toBe(false)
    pointer('pointercancel'); cleanPending(spine); cleanPending(neighbor)
    expect(prepared).not.toHaveBeenCalled()
  })
  it('cleans a pending hold on destroy without a later lift', async () => {
    pointer('pointerdown'); const old = spine
    shelf.destroy(); cleanPending(old)
    expect(old.isConnected).toBe(false)
    await vi.advanceTimersByTimeAsync(450)
    expect(old.classList.contains('is-lifted')).toBe(false); expect(prepared).not.toHaveBeenCalled()
  })
  it('preserves vertical touch scrolling and cleans the pending press', () => {
    mount(true, 'spine'); const scroller = container.querySelector('.ihr-bookshelf__scroll')
    pointer('pointerdown'); pointer('pointermove', { y:200 }); pointer('pointerup', { y:200 })
    expect(scroller.scrollTop).toBe(40); cleanPending(spine)
    expect(spine.classList.contains('is-pressed')).toBe(false)
    click(); expect(prepared).not.toHaveBeenCalled()
  })
})
