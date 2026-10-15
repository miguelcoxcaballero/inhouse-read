import './helpers/rust-ui-ready.js'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import * as rust from '../../src/js/readers/pdf-reflow.js'
import * as original from './helpers/reference-pdf-reflow.js'
import { extractPDFText } from '../../src/js/readers/pdf-text.js'
import { mapPDFTextLayer as rustMap } from '../../src/js/readers/pdf-text.js'
import { mapPDFTextLayer as originalMap } from './helpers/reference-pdf-text.js'

// The adaptable page is built by the compiled module and by the frozen original from the same
// layouts: every node, every canvas call, every timer and every result must be identical.
const viewport = { width:600, height:800, transform:[1, 0, 0, -1, 0, 800] }
let state, tick
function random() { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296 }
const pick = list => list[Math.floor(random() * list.length)]
function layoutFor(kind) {
  if (kind === 'empty') return extractPDFText({ items:[] }, viewport)
  const count = 1 + Math.floor(random() * 9), items = []
  for (let i = 0; i < count; i++) {
    const str = pick(['Before the picture.', 'After it. ', 'Ünïcode 🙂 text', 'x', 'A longer sentence with several words in it.', ' '])
    items.push(kind === 'plain' ? { str, hasEOL:random() > .5 }
      : { str, width:100 + random() * 300, height:12, transform:[12, 0, 0, 12, 40 + Math.floor(random() * 3) * 200, 800 - 60 - i * 40 - random() * 4], hasEOL:true })
  }
  return extractPDFText({ items }, viewport)
}
function rectsFor() {
  const count = Math.floor(random() * 7)
  return Array.from({ length:count }, () => {
    const x0 = Math.floor(random() * 400), y0 = Math.floor(random() * 600)
    return { x0, y0, x1:x0 + 1 + Math.floor(random() * 190), y1:y0 + 1 + Math.floor(random() * 190) }
  })
}

async function scenario(impl, seed, mode) {
  state = seed * 2246822519 >>> 0; tick = 0
  const log = []
  document.body.innerHTML = '<article><b>Previous complete page.</b></article>'
  const root = document.querySelector('article'), source = document.createElement('canvas'), old = document.createElement('canvas')
  source.width = 600; source.height = 800; old.width = 80; old.height = 120; root.append(old)
  const kind = pick(['plain', 'geometric', 'geometric', 'empty']), layout = layoutFor(kind), rects = rectsFor()
  const failAt = random() > .75 ? 1 + Math.floor(random() * 3) : 0, slow = pick([1, 5, 9]), channel = pick(['none', 'ports'])
  let draws = 0
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function () {
    return { drawImage:(...args) => { draws++; if (draws === failAt) throw new Error('crop failed'); log.push(['draw', this.width, this.height, this.className, args.slice(1)]) } }
  })
  vi.spyOn(performance, 'now').mockImplementation(() => tick += slow)
  if (channel === 'ports') {
    vi.stubGlobal('MessageChannel', class {
      constructor() { this.port1 = { close:() => log.push(['close', 1]), onmessage:null }; this.port2 = { close:() => log.push(['close', 2]), postMessage:() => { log.push(['post']); setTimeout(() => this.port1.onmessage?.(), 0) } } }
    })
    Object.defineProperty(document.defaultView, 'MessageChannel', { configurable:true, value:globalThis.MessageChannel })
  } else delete document.defaultView.MessageChannel
  let result, active = true
  const stop = 1 + Math.floor(random() * 9), isActive = random() > .5 ? () => { log.push(['active']); return !(--leftover < 1) } : undefined
  let leftover = stop
  try {
    if (mode === 'populate') { impl.populatePDFReflow(root, layout, source, rects, viewport); result = 'populated' }
    else if (mode === 'clear') { impl.clearPDFReflow(root); result = 'cleared' }
    else {
      const pending = isActive ? impl.preparePDFReflow(root, layout, source, rects, viewport, isActive) : impl.preparePDFReflow(root, layout, source, rects, viewport)
      log.push(['started', draws])
      pending.catch(() => {})
      await vi.runAllTimersAsync()
      result = await pending
    }
  } catch (error) { result = { threw:error.message } }
  await vi.runAllTimersAsync()
  const scene = { html:document.body.innerHTML, old:[old.width, old.height], text:root.textContent, canvases:[...root.querySelectorAll('canvas')].map(canvas => [canvas.width, canvas.height, canvas.style.width, canvas.getAttribute('role'), canvas.getAttribute('aria-label')]) }
  vi.restoreAllMocks(); vi.unstubAllGlobals()
  return { kind, rects: rects.length, result, log, scene, active }
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = '' })

it('builds, prepares and clears adaptable pages exactly like the original on three hundred scripted pages', async () => {
  const seen = { populated:0, prepared:0, cancelled:0, failed:0, pictures:0, sliced:0 }
  for (let seed = 1; seed <= 300; seed++) {
    const mode = ['populate', 'prepare', 'prepare', 'clear'][seed % 4]
    const reference = await scenario(original, seed, mode), actual = await scenario(rust, seed, mode)
    expect(actual, `seed ${seed} ${mode} ${reference.kind}`).toEqual(reference)
    if (mode === 'populate' && reference.result === 'populated') seen.populated++
    if (mode === 'prepare' && reference.result === true) seen.prepared++
    if (mode === 'prepare' && reference.result === false) seen.cancelled++
    if (reference.result?.threw) seen.failed++
    seen.pictures += reference.scene.canvases.length
    if (reference.log.some(entry => entry[0] === 'post' || entry[0] === 'close')) seen.sliced++
  }
  expect(seen.populated).toBeGreaterThan(30)
  expect(seen.prepared).toBeGreaterThan(40)
  expect(seen.cancelled).toBeGreaterThan(10)
  expect(seen.failed).toBeGreaterThan(10)
  expect(seen.pictures).toBeGreaterThan(200)
  expect(seen.sliced).toBeGreaterThan(20)
})

it('maps the reordered text layer exactly like the original', () => {
  for (let seed = 1; seed <= 120; seed++) {
    state = seed * 3266489917 >>> 0
    const layout = layoutFor(pick(['plain', 'geometric', 'geometric']))
    document.body.innerHTML = '<div class="layer"></div>'
    const layer = document.querySelector('.layer')
    for (const item of layout.items) { if (!item.str) continue; const span = document.createElement('span'); span.textContent = item.str; layer.append(span) }
    if (seed % 7 === 0 && layer.firstChild) layer.firstChild.textContent += '!'
    const a = originalMap(layer, layout), b = rustMap(layer, layout)
    expect(Boolean(b), `seed ${seed}`).toBe(Boolean(a))
    if (!a) continue
    expect(b.text).toBe(a.text)
    const total = a.text.length
    for (let i = 0; i < 40; i++) {
      const start = Math.floor(random() * (total + 4)) - 2, end = start + Math.floor(random() * 30) - 3
      const x = a.rangeFor(start, end), y = b.rangeFor(start, end)
      expect(Boolean(y)).toBe(Boolean(x))
      if (x) { expect([y.startContainer, y.startOffset, y.endContainer, y.endOffset]).toEqual([x.startContainer, x.startOffset, x.endContainer, x.endOffset]) }
      const node = pick([...layer.childNodes, document.body]).firstChild ?? layer, offset = Math.floor(random() * 12) - 1
      expect(b.offsetOf(node, offset)).toBe(a.offsetOf(node, offset))
    }
  }
})
