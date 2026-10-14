import './helpers/rust-ui-ready.js'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import * as ui from '../../src/wasm/ui/inhouse_read_ui.js'
vi.mock('foliate-js/view.js', () => ({}))
vi.mock('foliate-js/overlayer.js', () => ({ Overlayer:{} }))
vi.mock('../../src/js/gestures.js', () => ({ attachSwipeNavigation:() => () => {} }))
import { FoliateReader } from '../../src/js/readers/foliate-reader.js'

// Page turns, followed sentences, snapshots and searches leave nothing owned by the module
// behind, and the module's memory stops growing once it has seen a session of each.
const wasm = ui.initSync({ module:readFileSync('src/wasm/ui/inhouse_read_ui_bg.wasm') })
let container, view, create
beforeEach(() => {
  vi.useFakeTimers()
  document.body.innerHTML = '<main></main>'
  container = document.querySelector('main')
  Object.defineProperties(container, { clientWidth:{ configurable:true, get:() => 390 }, clientHeight:{ configurable:true, get:() => 700 } })
  container.getBoundingClientRect = () => ({ left:0, top:0, width:390, height:700, right:390, bottom:700 })
  create = document.createElement.bind(document)
  vi.stubGlobal('ResizeObserver', class { constructor(callback) { this.callback = callback } observe() {} disconnect() {} })
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = '' })

async function session() {
  view = document.createElement('div')
  const frame = document.createElement('iframe'); document.body.append(frame)
  const doc = frame.contentDocument
  doc.body.innerHTML = '<p>First sentence here. Second one follows.</p>'
  const text = doc.body.firstChild.firstChild, range = doc.createRange(); range.setStart(text, 0); range.setEnd(text, 5)
  frame.contentWindow.Range.prototype.getClientRects = function () { return [{ left:0, top:40, width:40, height:20, right:40, bottom:60 }] }
  let locked = false
  const turn = async () => { if (locked) return; locked = true; await new Promise(resolve => setTimeout(resolve, 100)); locked = false }
  Object.assign(view, {
    open:async () => {}, init:async () => {}, close() {}, book:{ sections:[], metadata:{}, toc:[] },
    lastLocation:{ range, fraction:.2, cfi:'c', section:{ current:1 } },
    renderer:{ getContents:() => [{ index:1, doc, overlayer:{ add() {}, remove() {} } }], getAttribute() {}, setAttribute() {}, removeAttribute() {}, setStyles() {},
      scrolled:false, size:600, start:0, end:600, viewSize:3000, scrollToAnchor:async () => {}, snap() {} },
    next:turn, prev:turn, goTo:async () => {}, goToFraction:async () => {},
    search:async function* () { yield { cfi:'c1', excerpt:'plain' }; yield { cfi:'c2', excerpt:{ pre:'a', match:'b', post:'c' } } }, clearSearch() {}
  })
  vi.spyOn(document, 'createElement').mockImplementation(name => name === 'foliate-view' ? view : create(name))
  const reader = new FoliateReader()
  await reader.open(container, new File(['epub'], 'book.epub'), { onRelocate() {} })
  const pending = [reader.next(), reader.next(), reader.prev()]
  await vi.advanceTimersByTimeAsync(400)
  await Promise.all(pending)
  const source = await reader.getSpeechSource()
  source.highlight(0, 5); source.follow(0, 5); source.follow(10, 20); source.clear()
  await vi.advanceTimersByTimeAsync(500)
  await reader.search('query')
  await reader.applyPreferences({ theme:'night', flow:'scrolled' })
  view.dispatchEvent(new CustomEvent('relocate', { detail:{ index:1, fraction:.5 } }))
  reader.close()
  await vi.advanceTimersByTimeAsync(500)
  vi.restoreAllMocks()
  frame.remove()
}

it('leaves no callback behind and does not grow the module memory over a long session', async () => {
  const baseline = ui.ui_pending_callbacks()
  for (let round = 0; round < 15; round++) await session()
  const before = wasm.memory.buffer.byteLength
  for (let round = 0; round < 100; round++) await session()
  expect(ui.ui_pending_callbacks()).toBe(baseline)
  expect(wasm.memory.buffer.byteLength).toBe(before)
}, 120_000)
