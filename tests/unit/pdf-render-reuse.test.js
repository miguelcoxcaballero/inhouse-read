import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ documents:[], layers:[] }))
vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  GlobalWorkerOptions:{}, OPS:{},
  getDocument:() => state.documents.shift(),
  TextLayer:class {
    constructor({ container, textContentSource }) { this.container = container; this.content = textContentSource; state.layers.push(this) }
    async render() {
      for (const item of this.content.items) {
        const span = document.createElement('span'); span.textContent = item.str; this.container.append(span)
      }
    }
    cancel = vi.fn()
  }
}))
vi.mock('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url', () => ({ default:'worker.mjs' }))
vi.mock('../../src/js/gestures.js', () => ({ attachSwipeNavigation:() => () => {} }))
import { PdfReader } from '../../src/js/readers/pdf-reader.js'

const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
let reader, container, width, height, pages, renders, relocate
function page(number) {
  const value = {
    getViewport:({ scale }) => ({ width:600 * scale, height:900 * scale }),
    imageCoordinates:new Float32Array(), getOperatorList:async () => ({ fnArray:[] }),
    getTextContent:vi.fn(async () => ({ items:[{ str:`Page ${number}.`, hasEOL:true }] })),
    render:vi.fn(({ canvasContext }) => {
      const task = { promise:Promise.resolve(), cancel:vi.fn() }
      renders.push({ number, canvas:canvasContext.canvas, task }); return task
    })
  }
  pages.set(number, value); return value
}
function documentTask(promise) {
  const pdf = { numPages:4, getPage:vi.fn(async number => pages.get(number) || page(number)) }
  const task = { promise:promise || Promise.resolve(pdf), destroy:vi.fn() }
  state.documents.push(task); return { pdf, task }
}
async function open(options = {}) {
  documentTask(); reader = new PdfReader()
  await reader.open(container, new ArrayBuffer(0), { onRelocate:relocate, ...options })
}
beforeEach(() => {
  document.body.innerHTML = '<main></main>'; container = document.querySelector('main')
  width = 390; height = 748; pages = new Map(); renders = []; state.layers.length = 0; state.documents.length = 0
  Object.defineProperties(container, {
    clientWidth:{ configurable:true, get:() => width }, clientHeight:{ configurable:true, get:() => height }
  })
  container.getBoundingClientRect = () => ({ left:0, top:48, width, height, right:width, bottom:height + 48 })
  container.scrollTo = vi.fn(); relocate = vi.fn()
  vi.stubGlobal('devicePixelRatio', 2)
  vi.stubGlobal('requestAnimationFrame', callback => { callback(0); return 1 })
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function () {
    return { canvas:this, clearRect:vi.fn(), drawImage:vi.fn() }
  })
})
afterEach(() => { reader?.close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = '' })

describe('PDF complete render reuse', () => {
  it('opens page 1 by default and restores an unchanged saved page without painting it again', async () => {
    await open(); await reader.goToPage(3)
    const canvas = container.querySelector('canvas'), span = container.querySelector('.pdf-text-layer span')
    await reader.goToPage(3)
    expect(renders.map(item => item.number)).toEqual([1, 3])
    expect(state.layers).toHaveLength(2)
    expect(container.querySelector('canvas')).toBe(canvas)
    expect(container.querySelector('.pdf-text-layer span')).toBe(span)
    expect(await reader.getPageSnapshot()).toMatchObject({ text:'Page 3.\n', location:{ locator:{ kind:'pdf-page', value:3 } } })
  })

  it('paints only the saved initial page with its initial zoom and theme', async () => {
    await open({ initialPage:3, preferences:{ zoom:150, theme:'night' } })
    expect(renders.map(item => item.number)).toEqual([3])
    expect(container.querySelector('canvas').width).toBe(1170)
    const span = container.querySelector('.pdf-text-layer span')
    await reader.applyPreferences({ zoom:150, theme:'night' }); await reader.goToPage(3)
    expect(renders).toHaveLength(1)
    expect(container.querySelector('.pdf-text-layer span')).toBe(span)
    expect(await reader.getPageSnapshot()).toMatchObject({ label:'Página 3 de 4', text:'Page 3.\n' })
  })

  it('uses the same fraction rounding as the controller when a legacy record has no page locator', async () => {
    await open({ initialFraction:2 / 3 })
    expect(renders.map(item => item.number)).toEqual([3])
    expect(reader.currentPage).toBe(3)
  })

  it('opens saved reflow text without first rasterizing page 1', async () => {
    await open({ initialPage:3, preferences:{ pdfMode:'text', fontSize:28, margin:32 } })
    expect(renders).toEqual([])
    expect(state.layers).toEqual([])
    expect(container.querySelector('.pdf-reflow-page')).toMatchObject({ textContent:'Page 3.\n', hidden:false })
    expect(container.querySelector('.pdf-reflow-page').style.fontSize).toBe('28px')
    await reader.goToPage(3)
    expect(pages.get(3).getTextContent).toHaveBeenCalledOnce()
  })

  it('waits for and reuses the same pending page render instead of cancelling it', async () => {
    await open()
    const pending = deferred(), task = { promise:pending.promise, cancel:vi.fn() }
    page(3).render.mockImplementation(() => { renders.push({ number:3, task }); return task })
    const first = reader.goToPage(3)
    await Promise.resolve()
    const second = reader.goToPage(3)
    await Promise.resolve()
    expect(pages.get(3).render).toHaveBeenCalledOnce()
    expect(task.cancel).not.toHaveBeenCalled()
    pending.resolve(); await Promise.all([first, second])
    expect(state.layers).toHaveLength(2)
    expect(container.getAttribute('aria-busy')).toBe('false')
  })

  it.each(['width', 'height', 'dpr'])('repaints after a changed %s even when restoring the same page', async change => {
    await open()
    if (change === 'width') width = 640
    if (change === 'height') height -= 49
    if (change === 'dpr') vi.stubGlobal('devicePixelRatio', 3)
    await reader.goToPage(1)
    expect(renders).toHaveLength(2)
    if (change === 'width') expect(container.querySelector('canvas').width).toBe(1280)
    if (change === 'dpr') expect(container.querySelector('canvas').width).toBe(1170)
  })

  it('reuses successfully rethemed original pixels and the selectable layer on restore', async () => {
    await open()
    const span = container.querySelector('.pdf-text-layer span')
    await reader.applyPreferences({ theme:'sepia' }); await reader.goToPage(1)
    expect(renders).toHaveLength(1)
    expect(container.querySelector('.pdf-text-layer span')).toBe(span)
    const snapshot = await reader.getPageSnapshot()
    expect(snapshot.paper.source).not.toBe(snapshot.source)
  })

  it('waits for pending theme paint even if equivalent preferences are applied again', async () => {
    const operators = deferred()
    page(1).getOperatorList = vi.fn(() => operators.promise)
    await open()
    const first = reader.applyPreferences({ theme:'night' })
    await Promise.resolve()
    await reader.applyPreferences({ theme:'night' })
    const restoring = reader.goToPage(1)
    operators.resolve({ fnArray:[] }); await Promise.all([first, restoring])
    expect(renders).toHaveLength(1)
    expect(container.getAttribute('aria-busy')).toBe('false')
    await reader.goToPage(1)
    expect(renders).toHaveLength(1)
  })

  it.each(['text', 'nodes', 'canvas', 'layer-style'])('does not reuse a changed %s payload', async change => {
    await open()
    const layer = container.querySelector('.pdf-text-layer')
    if (change === 'text') layer.firstChild.textContent = 'Wrong book.'
    if (change === 'nodes') layer.replaceChildren(layer.firstChild.cloneNode(true))
    if (change === 'canvas') container.querySelector('canvas').width = 1
    if (change === 'layer-style') layer.style.width = '1px'
    await reader.goToPage(1)
    expect(renders).toHaveLength(2)
    expect(layer.textContent).toBe('Page 1.')
    expect(container.querySelector('canvas').width).toBe(780)
  })

  it('does not consider a cancelled render a completed reusable page', async () => {
    await open()
    const cancelled = Object.assign(new Error('Cancelled'), { name:'RenderingCancelledException' })
    page(3).render.mockReturnValueOnce({ promise:Promise.reject(cancelled), cancel:vi.fn() })
    await reader.goToPage(3); await reader.goToPage(3)
    expect(pages.get(3).render).toHaveBeenCalledTimes(2)
    expect(container.querySelector('.pdf-text-layer').textContent).toBe('Page 3.')
  })

  it('invalidates a deferred speech candidate even when the visible page pixels are reused', async () => {
    await open()
    const candidate = await reader.getNextSpeechSource()
    await reader.goToPage(1)
    expect(candidate.activate()).toBe(false)
    expect(reader.currentPage).toBe(1)
    expect(renders.map(item => item.number)).toEqual([1, 2])
  })

  it('reuses the committed audible staged page without rebuilding its mapping', async () => {
    await open()
    const candidate = await reader.getNextSpeechSource()
    expect(candidate.activate()).toBe(true)
    const span = container.querySelector('.pdf-text-layer span')
    await reader.goToPage(2)
    expect(renders.map(item => item.number)).toEqual([1, 2])
    expect(container.querySelector('.pdf-text-layer span')).toBe(span)
    expect((await reader.getSpeechSource()).text).toBe('Page 2.')
  })

  it('keeps same-page navigation scroll reset and relocation semantics', async () => {
    await open(); relocate.mockClear(); container.scrollTop = 200
    await reader.goToPage(1)
    expect(container.scrollTop).toBe(0)
    expect(relocate).toHaveBeenCalledExactlyOnceWith({ index:0, fraction:0 })
    expect(renders).toHaveLength(1)
  })

  it('does not reuse a previous document after close and reopen', async () => {
    await open(); reader.close(); documentTask()
    await reader.open(container, new ArrayBuffer(0))
    expect(renders).toHaveLength(2)
    expect(state.layers).toHaveLength(2)
  })

  it('does not resurrect a loading document after it closes or a newer open replaces it', async () => {
    const pending = deferred(), old = documentTask(pending.promise)
    reader = new PdfReader()
    const opening = reader.open(container, new ArrayBuffer(0))
    reader.close(); documentTask()
    await reader.open(container, new ArrayBuffer(0), { initialPage:3 })
    pending.resolve(old.pdf); await opening
    expect(reader.currentPage).toBe(3)
    expect(renders.map(item => item.number)).toEqual([3])
    expect(old.task.destroy).toHaveBeenCalledOnce()
  })
})
