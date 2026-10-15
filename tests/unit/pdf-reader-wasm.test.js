import './helpers/rust-ui-ready.js'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const world = vi.hoisted(() => ({ log:[], gestures:[], task:null }))
vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  GlobalWorkerOptions:{}, OPS:{ paintImageXObject:85, paintInlineImageXObject:86, paintImageMaskXObject:87 },
  getDocument:options => world.task(options),
  TextLayer:class {
    constructor({ container, textContentSource, viewport }) {
      Object.assign(this, { container, content:textContentSource, viewport })
      world.log.push(['TextLayer', textContentSource.items.length, viewport.scale, Object.keys(textContentSource).join()])
    }
    async render() {
      for (const item of this.content.items) {
        if (typeof item.str !== 'string' || !item.str) continue
        const span = document.createElement('span'); span.textContent = item.str; this.container.append(span)
        if (item.hasEOL) this.container.append(document.createElement('br'))
      }
      world.log.push(['TextLayer.render', this.container.childNodes.length])
    }
    cancel() { world.log.push(['TextLayer.cancel']) }
  }
}))
vi.mock('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url', () => ({ default:'worker.mjs' }))
vi.mock('../../src/js/gestures.js', () => ({
  attachSwipeNavigation:(element, options) => { world.gestures.push({ element, options }); return () => world.log.push(['gestures.detach']) }
}))
import { ReferencePdfReader } from './helpers/reference-pdf-reader.js'
import { PdfReader } from '../../src/js/readers/pdf-reader.js'

// The Rust reader is compared with the frozen JavaScript original on scripted sessions against the
// same fake PDF.js: every page it asks for, every raster it paints, every canvas call, every
// record it reports and every node it leaves behind, in order.
const rect = (left, top, width, height) => ({ left, top, width, height, right:left + width, bottom:top + height })
let dims, overflow, scrolls

function textOf(kind, number, random) {
  const item = (str, x, y, width = 190, size = 12) => ({ str, dir:'ltr', width, height:size, transform:[size, 0, 0, size, x, 800 - y], fontName:'f1', hasEOL:true })
  const styles = { f1:{ fontFamily:'serif', ascent:.8, descent:-.2 } }
  if (kind === 'blank') return { items:[], styles }
  if (kind === 'geometric') {
    return { items:[item(`Capítulo ${number}`, 50, 80, 490, 22), item('Derecha primera frase.', 330, 130), item('Izquierda segunda frase.', 50, 148), item('Izquierda primera frase.', 50, 130),
      item('Derecha segunda frase.', 330, 148), item('Párrafo separado a la izquierda.', 50, 180), item(`Página ${number} con más texto para el final.`, 330, 180)], styles }
  }
  const items = []
  for (let line = 0; line < 2 + Math.floor(random() * 14); line++) {
    items.push({ str:`Page ${number}, line ${line}. Another sentence closes this one. ${'Words go on. '.repeat(Math.floor(random() * 6))}`, hasEOL:random() > .3 })
  }
  return { items }
}

function pdfOf(seed, flavour, random) {
  const count = 3 + Math.floor(random() * 4), pages = new Map()
  const kinds = Array.from({ length:count }, () => ['plain', 'plain', 'geometric', 'image', 'blank', 'mask', 'noops'][Math.floor(random() * 7)])
  const delays = Array.from({ length:count }, () => flavour.slowRender && random() > .5 ? 20 + Math.floor(random() * 80) : 0)
  const page = number => {
    if (pages.has(number)) return pages.get(number)
    const kind = kinds[number - 1], text = textOf(kind, number, () => ((number * 7919 + seed * 104729) % 1000) / 1000)
    const value = {
      getViewport:({ scale }) => ({ width:600 * scale, height:800 * scale, transform:[scale, 0, 0, -scale, 0, 800 * scale], scale }),
      imageCoordinates:kind === 'image' ? new Float32Array([.1, .1, .6, .1, .1, .5, .5, .5, .9, .5, .5, .9]) : kind === 'noops' ? undefined : new Float32Array(),
      getTextContent:async () => { world.log.push(['getTextContent', number]); return structuredClone(text) },
      render:options => {
        const canvas = options.canvasContext.canvas
        world.log.push(['render', number, canvas.width, canvas.height, options.viewport.scale, Boolean(options.recordImages)])
        let fail
        const promise = new Promise((resolve, reject) => { fail = reject; if (delays[number - 1]) setTimeout(resolve, delays[number - 1]); else resolve() })
        promise.catch(() => {})
        return { promise, cancel:() => { world.log.push(['render.cancel', number]); const error = new Error('cancelled'); error.name = 'RenderingCancelledException'; fail(error) } }
      }
    }
    if (kind !== 'noops') value.getOperatorList = async () => { world.log.push(['getOperatorList', number]); return { fnArray:kind === 'image' ? [3, 85, 4] : kind === 'mask' ? [3, 87] : [1, 2, 3] } }
    pages.set(number, value); return value
  }
  return { count, kinds, pdf:{ numPages:count, getPage:async number => { world.log.push(['getPage', number]); if (flavour.pageFails === number) throw new Error(`page ${number} unavailable`); return page(number) } } }
}

function setup(flavour, random, seed) {
  world.log.length = 0; world.gestures.length = 0
  document.body.innerHTML = '<main></main>'
  const container = document.querySelector('main'), { count, kinds, pdf } = pdfOf(seed, flavour, random)
  dims = { width:[320, 390, 600, 820][Math.floor(random() * 4)], height:[480, 748, 900][Math.floor(random() * 3)] }
  overflow = 1200 + Math.floor(random() * 2400); scrolls = []
  Object.defineProperties(container, {
    clientWidth:{ configurable:true, get:() => dims.width }, clientHeight:{ configurable:true, get:() => dims.height }, scrollHeight:{ configurable:true, get:() => overflow }
  })
  container.getBoundingClientRect = () => rect(0, 48, dims.width, dims.height)
  container.scrollTo = options => {
    scrolls.push(['scrollTo', options])
    if (options.top != null) container.scrollTop = Math.max(0, Math.min(overflow - dims.height, options.top))
    if (options.left != null) container.scrollLeft = options.left
  }
  container.scrollBy = options => { scrolls.push(['scrollBy', options]); container.scrollTo({ top:container.scrollTop + (options.top || 0), left:container.scrollLeft + (options.left || 0) }) }
  vi.spyOn(console, 'warn').mockImplementation((...args) => { world.log.push(['warn', args.map(value => String(value?.message ?? value)).join(' ')]) })
  const contexts = new Map()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function () {
    if (!contexts.has(this)) {
      contexts.set(this, new Proxy({ canvas:this }, {
        get:(target, key) => key in target ? target[key] : key === 'measureText' ? () => ({ width:10 }) : (...args) => { world.log.push(['2d', String(key), this.width, this.height, ...args.map(value => value?.width ?? (typeof value === 'object' ? 'object' : value))]) },
        set:(target, key, value) => { target[key] = value; world.log.push(['2d=', String(key), value]); return true }
      }))
    }
    return contexts.get(this)
  })
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => callback(new Blob(['HD'], { type:'image/jpeg' })))
  vi.stubGlobal('devicePixelRatio', [1, 2, 3][Math.floor(random() * 3)])
  vi.stubGlobal('requestAnimationFrame', callback => { callback(0); return 1 })
  vi.stubGlobal('matchMedia', flavour.noMatchMedia ? undefined : () => ({ matches:Boolean(flavour.reduced) }))
  const observers = []
  vi.stubGlobal('ResizeObserver', class { constructor(callback) { this.callback = callback; observers.push(this) } observe() {} disconnect() { world.log.push(['observer.disconnect']) } })
  const layout = function () {
    if (flavour.noRects) return []
    const root = this.startContainer.parentElement?.closest('.pdf-reflow-page, .pdf-text-layer') ?? document.body
    let total = 0, at = 0
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    for (let current = walker.nextNode(); current; current = walker.nextNode()) { if (current === this.startContainer) { at = total + this.startOffset; break } total += current.nodeValue.length }
    const top = 48 + 20 * Math.floor(at / 38) - container.scrollTop
    return [rect((at % 38) * 8, top, Math.max(1, (this.endOffset - this.startOffset) * 8), 20)]
  }
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable:true, value:layout })
  if (flavour.highlights) {
    vi.stubGlobal('Highlight', class { constructor(range) { this.range = range } })
    vi.stubGlobal('CSS', { highlights:new Map() })
  }
  const task = flavour.slowOpen ? { promise:new Promise(resolve => setTimeout(() => resolve(pdf), 40)), destroy:() => world.log.push(['destroy']) }
    : flavour.openFails ? { promise:Promise.reject(new Error('Invalid PDF')), destroy:() => world.log.push(['destroy']) }
    : { promise:Promise.resolve(pdf), destroy:() => world.log.push(['destroy']) }
  task.promise.catch(() => {})
  world.task = options => { world.log.push(['getDocument', Object.keys(options)]); return task }
  return { container, count, kinds, observers }
}

const PREFERENCES = [{}, { pdfMode:'text' }, { pdfMode:'text', fontSize:28, margin:32, lineHeight:2 }, { theme:'night' }, { theme:'sepia', zoom:150 }, { theme:'amoled', pdfMode:'original' },
  { zoom:125 }, { pdfMode:'text', theme:'sage', font:'mono', align:'justify', fontWeight:600 }, { theme:'paper' }, { zoom:100, pdfMode:'original' }, { theme:'night', pdfMode:'text' }]

async function run(Reader, seed, flavour) {
  let state = seed * 2654435761 >>> 0
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296 }
  const pick = list => list[Math.floor(random() * list.length)]
  vi.useFakeTimers()
  const w = setup(flavour, random, seed), raw = new Reader(), trace = [], relocations = [], sources = []
  // Fake time only moves when told: every call is driven until it settles, so a slow render cannot stall the script.
  const wait = async promise => {
    let done = false
    const result = Promise.resolve(promise)
    result.then(() => { done = true }, () => { done = true })
    for (let tick = 0; tick < 400 && !done; tick++) await vi.advanceTimersByTimeAsync(25)
    if (!done) throw new Error('never settled')
    return result
  }
  const reader = new Proxy(raw, { get:(target, key) => typeof target[key] === 'function' ? (...args) => wait(target[key](...args)) : target[key] })
  const scene = () => {
    const nodes = [...w.container.querySelectorAll('canvas')].map(canvas => [canvas.width, canvas.height, canvas.style.width, canvas.style.height])
    return { html:w.container.outerHTML.replace(/\s+/g, ' '), nodes, scrolls:[...scrolls], top:w.container.scrollTop, zoomed:w.container.dataset.readerZoomed, page:reader.currentPage, pages:reader.pageCount }
  }
  const note = (name, value) => trace.push({ name, value, relocations:JSON.parse(JSON.stringify(relocations)), log:JSON.parse(JSON.stringify(world.log)), scene:scene() })
  const settle = async ms => { await vi.advanceTimersByTimeAsync(ms) }
  const navigations = []
  const options = random() > .5 ? { initialPage:1 + Math.floor(random() * w.count) } : random() > .5 ? { initialLocator:{ kind:'pdf-page', value:1 + Math.floor(random() * w.count), textOffset:Math.floor(random() * 80) } } : { initialFraction:random() }
  if (random() > .5) options.preferences = pick(PREFERENCES)
  let opened
  if (process.env.PDF_TRACE) process.stderr.write(`seed ${seed} opening ${JSON.stringify(options)}\n`)
  try { await reader.open(w.container, new ArrayBuffer(0), { ...options, onRelocate:record => relocations.push(record), onToggleChrome:() => navigations.push('chrome'), onUserNavigation:() => navigations.push('user') }); opened = 'ok' }
  catch (error) { opened = { threw:error.message, name:error.name } }
  if (process.env.PDF_TRACE) process.stderr.write(`seed ${seed} opened ${JSON.stringify(opened)}\n`)
  note('opened', { opened, options })
  const fire = async name => { const value = world.gestures.at(-1)?.options; return value ? await value[name]?.() : 'no gestures' }
  const operations = [
    async () => { const n = 0 + Math.floor(random() * (w.count + 2)); await reader.goToPage(n, pick([undefined, {}, { textOffset:Math.floor(random() * 90) }, { edge:'end' }, { textOffset:'7' }, { textOffset:-5 }, { textOffset:Infinity }, { edge:'end', textOffset:3 }])); return n },
    async () => { await reader.goToPage('3'); await reader.goToPage(NaN); return 'strings' },
    async () => { const both = Promise.allSettled([reader.goToPage(1 + Math.floor(random() * w.count)), reader.goToPage(1 + Math.floor(random() * w.count))]); await settle(50); return (await both).map(item => item.status) },
    async () => { await reader.next(pick([undefined, { source:true }, { isActive:() => false }, { isActive:() => true }])); return 'next' },
    async () => { await reader.prev(); return 'prev' },
    async () => { await reader.next(); await reader.next(); await reader.prev(); return 'sequence' },
    async () => { await reader.toggleZoom(pick([undefined, 40, 200]), pick([undefined, 100, 400])); return 'zoom' },
    async () => { await reader.applyPreferences(pick(PREFERENCES)); return 'prefs' },
    async () => { const both = Promise.allSettled([reader.applyPreferences(pick(PREFERENCES)), reader.applyPreferences(pick(PREFERENCES))]); await settle(100); return (await both).map(item => item.status) },
    async () => { dims = { width:[320, 390, 600, 820, 0][Math.floor(random() * 5)], height:[480, 748, 900, 0][Math.floor(random() * 4)] }; for (const observer of w.observers) observer.callback(); await settle(random() > .5 ? 30 : 100); return dims },
    async () => { w.container.scrollTop = Math.floor(random() * (overflow - dims.height)); w.container.dispatchEvent(new Event('scroll')); await settle(random() > .5 ? 100 : 200); return w.container.scrollTop },
    async () => { w.container.dispatchEvent(Object.assign(new Event('wheel'), { deltaX:random() > .5 ? 3 : 0, deltaY:random() > .5 ? 5 : 0 })); return navigations.length },
    async () => { const text = await reader.getSpeechText(); return text.slice(0, 60) },
    async () => {
      const source = await reader.getSpeechSource({ completeSentences:random() > .5 }); if (!source) return null
      sources.push(source)
      source.highlight(0, 5); source.follow(0, 5); source.highlight(4, 20); source.follow(10, 30); source.clear(); source.highlight(2, 2)
      await settle(100)
      const map = { text:source.text.slice(0, 50), start:source.start, previous:source.previousText?.slice(0, 20), page:source.physicalPage, headers:Object.keys(source).join(), marks:document.querySelectorAll('.inhouse-speech-current').length }
      return { ...map, foreign:source.offsetAtPoint({}, 5, 5), own:source.offsetAtPoint(document, 5, 5) }
    },
    async () => { const source = sources.at(-1); if (!source) return 'none'; source.highlight(3, 9); source.follow(1, 8); await settle(100); return document.querySelectorAll('.inhouse-speech-current').length },
    async () => {
      const active = random() > .2
      const source = await reader.getNextSpeechSource({ isActive:() => active, afterPage:pick([undefined, undefined, 2, 3, 1.5]) })
      if (!source) return null
      sources.push(source)
      const before = { valid:source.isValid(), keys:Object.keys(source).join(), text:source.text.slice(0, 40), page:source.physicalPage }
      const activated = random() > .3 ? source.activate() : 'skipped'
      source.highlight(0, 4); source.follow(0, 4)
      await settle(50)
      return { before, activated, valid:source.isValid(), page:reader.currentPage, again:random() > .5 ? source.clear() : 'kept' }
    },
    async () => { const source = sources.at(-1); if (!source) return 'none'; return { valid:source.isValid?.(), activate:source.activate?.(), clear:source.clear() } },
    async () => { reader.browseSpeech(); return 'browse' },
    async () => { await reader.returnToSpeech(); await settle(100); return 'return' },
    async () => { reader.stopSpeech(); return 'stop' },
    async () => { const result = await reader.getPageSnapshot(pick([undefined, {}, { reuseSettledLayout:true }, { reuseSettledLayout:false }])); return result && { engine:result.engine, type:result.sourceType, text:result.text?.slice(0, 40), label:result.label, location:result.location, keys:Object.keys(result).join(), tone:Boolean(result.toneKey) } },
    async () => { const both = Promise.allSettled([reader.getPageSnapshot({ reuseSettledLayout:true }), reader.goToPage(1 + Math.floor(random() * w.count))]); await settle(100); return (await both).map(item => item.status + (item.value?.label ?? '')) },
    async () => { const results = await reader.search(pick(['page', 'sentence', 'Words go', '  ', '', 'xyz', 'LINE 1', 'a', 'frase'])); return { length:results.length, first:results[0], last:results.at(-1) } },
    async () => { const metadata = await reader.getLengthMetadata(); await settle(100); return metadata },
    async () => { const controller = new AbortController(); const pending = reader.getCoverBlob({ signal:controller.signal, retainOnClose:random() > .5 }); if (random() > .6) controller.abort(); await settle(100); const blob = await pending; return blob && { size:blob.size, type:blob.type } },
    async () => { window.getSelection().removeAllRanges(); return reader.getSelection() },
    async () => {
      const outer = world.gestures.at(-1)?.options; if (!outer) return 'none'
      const result = { canSwipe:outer.canSwipe(), surface:outer.getMotionSurface()?.className }
      outer.onManualPan(); const all = Promise.allSettled([outer.onNext(), outer.onPrev(), outer.onToggleZoom(30, 40)]); await settle(150)
      result.settled = (await all).map(item => item.status); result.hold = typeof outer.canLongPress; return result
    }
  ]
  const steps = flavour.long ? 36 : 22
  for (let step = 0; step < steps; step++) {
    const index = Math.floor(random() * operations.length)
    let result
    if (process.env.PDF_TRACE) process.stderr.write(`seed ${seed} step ${step} op ${index}\n`)
    try { result = await operations[index]() } catch (error) { result = { threw:String(error?.message ?? error), name:error?.name } }
    await settle(random() > .5 ? 0 : 20)
    note(`step${step}:${index}`, result)
  }
  reader.close()
  await settle(300)
  const after = []
  for (const call of [() => reader.getPageSnapshot(), () => reader.next(), () => reader.prev(), () => reader.search('page'), () => reader.getSpeechSource(), () => reader.getSpeechText(), () => reader.getLengthMetadata(),
    () => reader.getCoverBlob(), () => reader.goToPage(2), () => reader.toggleZoom(), () => reader.returnToSpeech(), () => reader.getNextSpeechSource({ isActive:() => true })]) {
    try { after.push(await call()) } catch (error) { after.push({ threw:error.message, name:error.name }) }
  }
  note('closed', { after, html:w.container.outerHTML, sourcesValid:sources.map(source => source.isValid?.()) })
  vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); delete Range.prototype.getClientRects; document.body.innerHTML = ''
  return trace
}

beforeEach(() => { vi.restoreAllMocks() })
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); delete Range.prototype.getClientRects; document.body.innerHTML = '' })

it('behaves exactly like the original on one hundred and fifty scripted sessions', async () => {
  const flavours = [{}, { slowRender:true }, { highlights:true }, { reduced:true, slowRender:true }, { noRects:true, noMatchMedia:true }, { slowOpen:true, highlights:true }, { pageFails:2 }, { long:true, slowRender:true, highlights:true }, { openFails:true }]
  const seen = { scenes:0, text:0, canvases:0, renders:0, cancels:0, snapshots:0, speech:0, staged:0, searches:0, covers:0, relocations:0, errors:0 }
  for (let seed = 1; seed <= (Number(process.env.PDF_SEEDS) || 150); seed++) {
    const flavour = flavours[seed % flavours.length]
    const reference = await run(ReferencePdfReader, seed, flavour)
    const rust = await run(PdfReader, seed, flavour)
    expect(rust.length, `seed ${seed}`).toBe(reference.length)
    for (let index = 0; index < reference.length; index++) expect(rust[index], `seed ${seed} flavour ${JSON.stringify(flavour)} note ${reference[index].name}`).toEqual(reference[index])
    for (const entry of reference) {
      const text = JSON.stringify(entry.log.slice(-60))
      seen.scenes++
      if (entry.scene.html.includes('pdf-reflow-page') && /<article[^>]*>[^<]+/.test(entry.scene.html)) seen.text++
      if (entry.scene.nodes.length) seen.canvases++
      if (entry.name.endsWith(':21') || entry.name.endsWith(':22')) seen.snapshots++
      if (/:1[2-9]$|:20$/.test(entry.name)) seen.speech++
      if (entry.name.endsWith(':15') && entry.value?.activated === true) seen.staged++
      if (entry.name.endsWith(':23')) seen.searches++
      if (entry.name.endsWith(':25')) seen.covers++
      if (entry.value?.threw) seen.errors++
      if (text.includes('render.cancel')) seen.cancels++
    }
    seen.renders += reference.at(-1).log.filter(entry => entry[0] === 'render').length
    seen.relocations += reference.at(-1).relocations.length
  }
  expect(seen.scenes).toBeGreaterThan(3000)
  expect(seen.text).toBeGreaterThan(400)
  expect(seen.canvases).toBeGreaterThan(1500)
  expect(seen.renders).toBeGreaterThan(600)
  expect(seen.snapshots).toBeGreaterThan(40)
  expect(seen.speech).toBeGreaterThan(200)
  expect(seen.searches).toBeGreaterThan(20)
  expect(seen.relocations).toBeGreaterThan(800)
}, 600_000)
