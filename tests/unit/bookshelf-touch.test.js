import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderBookshelf } from '../../src/js/bookshelf.js'

const scene = vi.hoisted(() => ({ getBookAtPoint:vi.fn(), getObjectAtPoint:vi.fn() }))
vi.mock('../../src/js/book-model.js', () => ({ getBookRenderer:() => ({}), bookView:() => null, fitCoverImage:vi.fn(), planReadingBookPose:vi.fn() }))
vi.mock('../../src/js/bookshelf-scene.js', () => ({ createBookshelfScene:() => ({
  ...scene, dispose:vi.fn(), updateLayout:vi.fn(), updateEntry:vi.fn(), flush:vi.fn(), getBookPose:() => null,
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
const click = (detail = 1) => spine.dispatchEvent(new MouseEvent('click', { detail, clientX:90, clientY:240, bubbles:true }))
const cancelSelection = () => document.dispatchEvent(new KeyboardEvent('keydown', { key:'Escape', bubbles:true }))
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); localStorage.clear()
  vi.stubGlobal('WebGLRenderingContext', function () {})
  localStorage.setItem('inhouse-read-shelf-plants', '[]')
  container = document.createElement('div'); document.body.append(container)
  prepared = vi.fn()
  shelf = renderBookshelf(container, [{ id:'touch-book', title:'Libro táctil', format:'PDF' }], {
    shelfWidth:390, viewMode:'isometric', onPrepareBook:prepared,
    // Hold the real selection before its flyout: assertions observe activation,
    // not renderer timing, and Escape can cancel it before a delayed click.
    coverSrcFor:() => new Promise(() => {})
  })
  spine = container.querySelector('.ihr-spine')
  scene.getBookAtPoint.mockReturnValue(spine)
  scene.getObjectAtPoint.mockReturnValue(spine)
})
afterEach(() => {
  shelf.destroy(); container.remove(); document.body.innerHTML = ''
  vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks()
})

describe('validated shelf touch activation', () => {
  it('opens on a short touch release even when Chromium emits no compatibility click after a pan', () => {
    pointer('pointerdown'); pointer('pointerup')
    expect(prepared).toHaveBeenCalledOnce()
    expect(prepared.mock.calls[0][0].id).toBe('touch-book')
  })

  it('does not open twice if a delayed compatibility click arrives after the selection was dismissed', () => {
    pointer('pointerdown'); pointer('pointerup')
    expect(prepared).toHaveBeenCalledOnce()
    cancelSelection(); click()
    expect(prepared).toHaveBeenCalledOnce()
    pointer('pointerdown'); pointer('pointerup')
    expect(prepared).toHaveBeenCalledTimes(2)
  })

  it('keeps keyboard and assistive clicks available without any pointer event', () => {
    click(0)
    expect(prepared).toHaveBeenCalledOnce()
  })

  it('waits for the mouse click and does not treat mouse release as touch', () => {
    pointer('pointerdown', { pointerType:'mouse' }); pointer('pointerup', { pointerType:'mouse' })
    expect(prepared).not.toHaveBeenCalled()
    click()
    expect(prepared).toHaveBeenCalledOnce()
  })

  it('does not retarget a touch whose down ray missed the book', () => {
    scene.getBookAtPoint.mockReturnValue(null)
    pointer('pointerdown')
    scene.getBookAtPoint.mockReturnValue(spine)
    pointer('pointerup'); click()
    expect(prepared).not.toHaveBeenCalled()
  })

  it('does not retarget a semantic button to another book hit by the down ray', () => {
    scene.getBookAtPoint.mockReturnValue(document.createElement('button'))
    pointer('pointerdown'); pointer('pointerup'); click()
    expect(prepared).not.toHaveBeenCalled()
  })

  it('keeps the validated down target when the pressure animation shifts its surface', () => {
    pointer('pointerdown')
    scene.getBookAtPoint.mockReturnValue(null)
    pointer('pointerup')
    expect(prepared).toHaveBeenCalledOnce()
    expect(scene.getBookAtPoint).toHaveBeenCalledOnce()
  })

  it.each(['cancel', 'move', 'leave', 'hold', 'drag'])('does not turn %s into a tap or compatibility activation', async gesture => {
    pointer('pointerdown')
    if (gesture === 'hold' || gesture === 'drag') await vi.advanceTimersByTimeAsync(450)
    if (gesture === 'move' || gesture === 'drag') pointer('pointermove', { y:290 })
    if (gesture === 'leave') pointer('pointerleave')
    pointer(gesture === 'cancel' ? 'pointercancel' : 'pointerup', { y:gesture === 'move' || gesture === 'drag' ? 290 : 240 })
    await vi.advanceTimersByTimeAsync(1)
    click()
    expect(prepared).not.toHaveBeenCalled()
  })

  it('keeps assistive activation available after a cancelled touch', () => {
    pointer('pointerdown'); pointer('pointercancel'); click(0)
    expect(prepared).toHaveBeenCalledOnce()
  })

  it.each([true, false])('does not open from a pinch (secondary finger released first: %s)', secondaryFirst => {
    pointer('pointerdown')
    pointer('pointerdown', { id:2, primary:false, x:150 })
    if (!secondaryFirst) pointer('pointerup')
    pointer('pointerup', { id:2, primary:false, x:150 })
    if (secondaryFirst) pointer('pointerup')
    click()
    expect(prepared).not.toHaveBeenCalled()
  })

  it.each(['cancel', 'hold', 'pinch'])('accepts a fresh tap immediately after %s even when neither gesture emits a click', async gesture => {
    pointer('pointerdown')
    if (gesture === 'hold') await vi.advanceTimersByTimeAsync(450)
    if (gesture === 'pinch') {
      pointer('pointerdown', { id:2, primary:false, x:150 })
      pointer('pointerup', { id:2, primary:false, x:150 })
    }
    pointer(gesture === 'cancel' ? 'pointercancel' : 'pointerup')
    expect(prepared).not.toHaveBeenCalled()
    // No zero-delay cleanup timer or compatibility click between gestures.
    pointer('pointerdown', { id:3 }); pointer('pointerup', { id:3 })
    expect(prepared).toHaveBeenCalledOnce()
  })

  it('ignores a release from another pointer and accepts the matching release', () => {
    pointer('pointerdown')
    pointer('pointerup', { id:7, primary:false })
    expect(prepared).not.toHaveBeenCalled()
    pointer('pointerup')
    expect(prepared).toHaveBeenCalledOnce()
  })
})
