import './helpers/rust-ui-ready.js'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import * as ui from '../../src/wasm/ui/inhouse_read_ui.js'

const world = vi.hoisted(() => ({ count:5 }))
vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  GlobalWorkerOptions:{}, OPS:{ paintImageXObject:85 },
  getDocument:() => ({ promise:Promise.resolve({ numPages:world.count, getPage:async number => ({
    getViewport:({ scale }) => ({ width:600 * scale, height:800 * scale, transform:[scale, 0, 0, -scale, 0, 800 * scale] }),
    getTextContent:async () => ({ items:[{ str:`Page ${number}. A sentence. Another sentence follows it.`, hasEOL:true }] }),
    imageCoordinates:new Float32Array(), getOperatorList:async () => ({ fnArray:[] }),
    render:() => ({ promise:Promise.resolve(), cancel() {} })
  }) }), destroy() {} }),
  TextLayer:class {
    constructor({ container, textContentSource }) { this.container = container; this.content = textContentSource }
    async render() { for (const item of this.content.items) { const span = document.createElement('span'); span.textContent = item.str; this.container.append(span) } }
    cancel() {}
  }
}))
vi.mock('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url', () => ({ default:'worker.mjs' }))
vi.mock('../../src/js/gestures.js', () => ({ attachSwipeNavigation:() => () => {} }))
import { PdfReader } from '../../src/js/readers/pdf-reader.js'

// Timers, frames and promise reactions are owned by the module until they run or are cancelled:
// opening, navigating, resizing, speaking and closing, again and again, leaves nothing behind.
const wasm = ui.initSync({ module:readFileSync('src/wasm/ui/inhouse_read_ui_bg.wasm') })
let container, observer, height
beforeEach(() => {
  vi.useFakeTimers()
  document.body.innerHTML = '<main></main>'
  container = document.querySelector('main'); height = 700
  Object.defineProperties(container, { clientWidth:{ configurable:true, get:() => 390 }, clientHeight:{ configurable:true, get:() => height }, scrollHeight:{ configurable:true, get:() => 2400 } })
  container.getBoundingClientRect = () => ({ left:0, top:48, width:390, height, right:390, bottom:height + 48 })
  container.scrollTo = options => { if (options.top != null) container.scrollTop = options.top }
  container.scrollBy = vi.fn()
  vi.stubGlobal('ResizeObserver', class { constructor(callback) { observer = callback } observe() {} disconnect() {} })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function () { return { canvas:this, clearRect() {}, drawImage() {}, fillRect() {}, measureText:() => ({ width:10 }) } })
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable:true, value:() => [{ left:0, top:60, width:40, height:20, right:40, bottom:80 }] })
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); delete Range.prototype.getClientRects; document.body.innerHTML = '' })

async function cycle(mode) {
  const reader = new PdfReader()
  await reader.open(container, new ArrayBuffer(0), { onRelocate() {}, preferences:{ pdfMode:mode } })
  await reader.goToPage(2)
  container.scrollTop = 500; container.dispatchEvent(new Event('scroll'))
  height -= 20; observer(); height += 20
  const source = await reader.getSpeechSource()
  source.follow(0, 6); source.highlight(0, 6)
  const next = await reader.getNextSpeechSource()
  if (mode === 'original') next.activate()
  reader.browseSpeech(); void reader.returnToSpeech()
  await reader.applyPreferences({ pdfMode:mode, theme:'night' })
  await reader.next(); await reader.prev()
  reader.close()
}

it('leaves no timer or callback behind after thousands of scheduled and cancelled timers', async () => {
  const baseline = ui.ui_pending_callbacks()
  for (let round = 0; round < 60; round++) await cycle(round % 2 ? 'text' : 'original')
  await vi.runAllTimersAsync()
  expect(ui.ui_pending_callbacks()).toBe(baseline)
})

it('does not grow the module memory over a long session of pages', async () => {
  for (let round = 0; round < 20; round++) await cycle(round % 2 ? 'text' : 'original')
  await vi.runAllTimersAsync()
  const before = wasm.memory.buffer.byteLength
  for (let round = 0; round < 150; round++) await cycle(round % 2 ? 'text' : 'original')
  await vi.runAllTimersAsync()
  expect(wasm.memory.buffer.byteLength).toBe(before)
})

it('releases a timer cancelled by a new page, a resize or closing before it ever fires', async () => {
  const baseline = ui.ui_pending_callbacks()
  const reader = new PdfReader()
  await reader.open(container, new ArrayBuffer(0), { onRelocate() {}, preferences:{ pdfMode:'text' } })
  container.dispatchEvent(new Event('scroll'))
  expect(ui.ui_pending_callbacks()).toBe(baseline + 1)
  container.dispatchEvent(new Event('scroll'))
  expect(ui.ui_pending_callbacks()).toBe(baseline + 1)
  height -= 30; observer()
  expect(ui.ui_pending_callbacks()).toBeGreaterThan(baseline)
  await reader.goToPage(3)
  reader.close()
  expect(ui.ui_pending_callbacks()).toBe(baseline)
})
