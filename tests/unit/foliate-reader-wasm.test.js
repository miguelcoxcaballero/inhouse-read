import './helpers/rust-ui-ready.js'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
vi.mock('foliate-js/view.js', () => ({}))
const gestures = vi.hoisted(() => ({ attached:[] }))
vi.mock('../../src/js/gestures.js', async importOriginal => ({ ...(await importOriginal()),
  attachSwipeNavigation:(element, options) => { gestures.attached.push({ element, options }); return () => gestures.attached.push({ detached:element }) } }))
import { Overlayer } from 'foliate-js/overlayer.js'
import { ReferenceFoliateReader, referenceOutline } from './helpers/reference-foliate-reader.js'
import { FoliateReader } from '../../src/js/readers/foliate-reader.js'
const rustOutline = Overlayer.outline
import { stablePageHeight as referencePageHeight } from './helpers/reference-page-box.js'
import { rustUI } from './helpers/rust-ui-ready.js'

// The Rust reader is compared with the frozen JavaScript original on scripted sessions against the
// same fake foliate view: every attribute it sets, every call it makes on the view, every record it
// reports, in order.
const rect = (left, top, width, height) => ({ left, top, width, height, right:left + width, bottom:top + height })
const parse = text => new DOMParser().parseFromString(`<html><body>${text}</body></html>`, 'text/html')
let dims

function world(flavour) {
  const log = []
  document.body.innerHTML = '<main></main>'
  const container = document.querySelector('main')
  Object.defineProperties(container, { clientWidth:{ get:() => dims.width, configurable:true }, clientHeight:{ get:() => dims.height, configurable:true } })
  container.getBoundingClientRect = () => rect(0, 0, dims.width, dims.height)
  const view = document.createElement('div')
  const frame = document.createElement('iframe'); document.body.append(frame)
  const attributes = new Map(), doc = frame.contentDocument
  doc.body.innerHTML = '<p>First sentence here. Second one follows.</p><p>Another paragraph of text.</p>'
  const text = doc.body.firstChild.firstChild
  const range = doc.createRange(); range.setStart(text, 0); range.setEnd(text, 5)
  let locked = false
  const turn = name => async () => {
    log.push([name, 'start']); if (flavour.failTurn === name && flavour.armed) throw new Error('turn failed')
    if (locked) return
    locked = true; view.lastLocation = { ...view.lastLocation, fraction:Math.min(1, view.lastLocation.fraction + (name === 'next' ? .1 : -.1)) }
    await new Promise(resolve => setTimeout(resolve, 100)); locked = false
  }
  Object.assign(view, {
    open:async file => { log.push(['open', file.name]) }, init:async options => { log.push(['init', options]) }, close:() => log.push(['close']),
    book:{ metadata:{ title:'T' }, toc:[{ label:'One' }], dir:flavour.rtl ? 'rtl' : 'ltr', sections:[], getCover:async () => { if (flavour.coverFails) throw new Error('no cover'); return flavour.cover ?? null } },
    lastLocation:{ range, fraction:.25, cfi:'epubcfi(/6/2)', tocItem:{ label:'Chapter' }, pageItem:flavour.page ? { label:'12' } : undefined, section:{ current:3 } },
    renderer:{ getContents:() => [{ index:3, doc, overlayer:{ add:(...args) => log.push(['overlay.add', args[0], args[1].toString()]), remove:name => log.push(['overlay.remove', name]) } }],
      getAttribute:name => attributes.get(name), setAttribute:(name, value) => { attributes.set(name, value); log.push(['attr', name, value]) },
      removeAttribute:name => { attributes.delete(name); log.push(['attr-', name]) }, setStyles:css => log.push(['styles', css.length, css.slice(0, 60)]),
      scrolled:flavour.scrolled, size:600, start:100, end:700, viewSize:5000, scrollToAnchor:async () => log.push(['scrollToAnchor']), snap:() => log.push(['snap']) },
    next:turn('next'), prev:turn('prev'), goTo:async target => log.push(['goTo', target]), goToFraction:async fraction => log.push(['goToFraction', fraction]),
    getCFI:(index, selected) => `cfi(${index}:${selected.startOffset})`, resolveCFI:() => ({ anchor:() => range }),
    search:async function* (options) { log.push(['search', options.query]); yield { cfi:'c1', excerpt:'plain excerpt' }; yield { label:'Sub', subitems:[{ cfi:'c2', excerpt:{ pre:'a', match:'b', post:null } }] }
      for (let i = 0; i < 250; i++) yield { cfi:`more-${i}`, excerpt:{ pre:'x', match:String(i) } } },
    clearSearch:() => log.push(['clearSearch']), addAnnotation:value => log.push(['annotate', value]), deleteAnnotation:value => log.push(['unannotate', value])
  })
  const layout = function () { return flavour.noRects ? [] : [rect(this.startOffset * 8, 40, Math.max(1, (this.endOffset - this.startOffset) * 8), 20)] }
  Range.prototype.getClientRects = layout; frame.contentWindow.Range.prototype.getClientRects = layout
  const create = document.createElement.bind(document)
  vi.spyOn(document, 'createElement').mockImplementation(name => name === 'foliate-view' ? view : create(name))
  const observers = []
  vi.stubGlobal('ResizeObserver', class { constructor(callback) { this.callback = callback; observers.push(this) } observe() {} disconnect() { log.push(['observer.disconnect']) } })
  return { log, container, view, doc, text, observers, attributes }
}

const PREFERENCES = [{}, { flow:'scrolled' }, { margin:48, flow:'paginated' }, { margin:0, theme:'night', fontSize:30 }, { theme:'sepia', lineHeight:2, align:'justify' },
  { fontWeight:600, margin:64, theme:'amoled' }, { theme:'sage', font:'mono', zoom:150 }]

async function run(Reader, seed, flavour) {
  let state = seed
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296 }
  localStorage.clear(); gestures.attached.length = 0
  dims = { width:[360, 390, 1000, 1280][Math.floor(random() * 4)], height:[640, 720, 800][Math.floor(random() * 3)] }
  vi.useFakeTimers()
  const w = world(flavour), reader = new Reader(), trace = [], relocations = []
  const matchMedia = flavour.reduced
  vi.stubGlobal('matchMedia', flavour.noMatchMedia ? undefined : () => ({ matches:matchMedia }))
  const navigations = []
  await reader.open(w.container, new File(['epub'], 'book.epub'), { onRelocate:record => relocations.push(record), onToggleChrome:() => {}, onUserNavigation:() => navigations.push('user'), onFollowLink:flavour.links ? href => navigations.push(href) : undefined })
  const note = (name, value) => trace.push({ name, value, log:JSON.parse(JSON.stringify(w.log)), relocations:JSON.parse(JSON.stringify(relocations)), navigations:[...navigations], diagnostic:reader.speechDiagnosticState })
  note('opened', null)
  const sources = []
  const operations = [
    async () => { const prefs = PREFERENCES[Math.floor(random() * PREFERENCES.length)]; await reader.applyPreferences({ ...prefs, ...(random() > .5 ? { flow:'scrolled' } : {}) }); return 'prefs' },
    async () => { dims = { width:[360, 390, 1000, 1280, 0][Math.floor(random() * 5)], height:[640, 720, 800, 0][Math.floor(random() * 4)] }; for (const observer of w.observers) observer.callback(); await vi.advanceTimersByTimeAsync(100); return dims },
    async () => { flavour.armed = true; const pending = [reader.next(), reader.next(), reader.prev()]; await vi.advanceTimersByTimeAsync(400); const outcome = (await Promise.allSettled(pending)).map(item => item.status + (item.reason?.message || '')); flavour.armed = false; return outcome },
    async () => { const active = random() > .3; const p = reader.next({ isActive:() => active }); await vi.advanceTimersByTimeAsync(250); return (await Promise.allSettled([p])).map(item => item.status) },
    async () => { w.view.dispatchEvent(new CustomEvent('relocate', { detail:random() > .5 ? { index:2, fraction:.5, cfi:'c', tocItem:{ label:'L' } } : { section:{ current:random() > .5 ? 4 : -1 }, pageItem:{ label:'P' } } })); return 'relocate' },
    async () => { const results = await reader.search(random() > .2 ? 'query' : '  '); return { length:results.length, first:results[0], second:results[1], last:results.at(-1) } },
    async () => { const doc = w.doc; doc.defaultView?.getSelection; return reader.getSelection() },
    async () => { await reader.goToFraction(.4); await reader.goToCfi('x'); await reader.goToTarget('#t'); return 'goto' },
    async () => { reader.browseSpeech(); return 'browse' },
    async () => { await reader.returnToSpeech(); return 'return' },
    async () => { reader.stopSpeech(); return 'stop' },
    async () => reader.getSpeechText(),
    async () => {
      const source = await reader.getSpeechSource({ visible:random() > .5 }); if (!source) return null
      sources.push(source)
      source.highlight(0, 5); source.follow(0, 5); source.follow(25, 30); source.highlight(7, 12); source.clear()
      await vi.advanceTimersByTimeAsync(500)
      return { text:source.text, start:source.start, offset:source.offsetAtPoint(w.doc, 5, 5), foreign:source.offsetAtPoint({}, 5, 5), breaks:Array.isArray(source.pageBreaks) }
    },
    async () => { sources.at(-1)?.follow(8, 14); await vi.advanceTimersByTimeAsync(600); return 'late-follow' },
    async () => {
      const outer = gestures.attached.find(entry => entry.element === w.container)?.options
      if (!outer) return 'none'
      const results = { canSwipe:outer.canSwipe() }
      outer.onManualPan(); outer.onNativeSwipe()
      const pending = [outer.onNext(), outer.onPrev()]; await vi.advanceTimersByTimeAsync(300)
      results.next = pending.every(turn => turn instanceof Promise); results.settled = (await Promise.allSettled(pending)).map(item => item.status)
      return results
    },
    async () => {
      w.view.dispatchEvent(new CustomEvent('load', { detail:{ doc:w.doc, index:3 } }))
      const inner = gestures.attached.at(-1)?.options
      const zones = inner ? [0, 100, 200, 350].map(x => inner.tapZone({ clientX:x, target:w.doc.body })) : null
      return { zones, handlers:Boolean(inner) }
    },
    async () => { w.view.dispatchEvent(new CustomEvent('link', { detail:{ href:'#x' }, cancelable:true })); w.view.dispatchEvent(new CustomEvent('draw-annotation', { detail:{ draw:(draw, options) => navigations.push(['draw', draw === Overlayer.highlight, options]), annotation:{ color:random() > .5 ? 'blue' : 'weird' } } })); return 'events' },
    async () => { reader.addQuoteAnnotation({ locator:{ kind:'cfi', value:'q' }, color:'pink' }); reader.removeQuoteAnnotation({ locator:{ kind:'epub' } }); reader.removeQuoteAnnotation({ locator:{ kind:'cfi', value:'q' } }); return 'quotes' },
    async () => ({ metadata:reader.metadata, toc:reader.toc, rtl:reader.rtl, cover:await reader.getCoverBlob() })
  ]
  for (let step = 0; step < 18; step++) {
    const index = Math.floor(random() * operations.length)
    let result
    try { result = await operations[index]() } catch (error) { result = { threw:String(error?.message ?? error), name:error?.name } }
    await vi.advanceTimersByTimeAsync(50)
    note(`step${step}:${index}`, result)
  }
  reader.close()
  await vi.advanceTimersByTimeAsync(600)
  note('closed', { container:w.container.className, html:w.container.innerHTML })
  vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals()
  return trace
}

beforeEach(() => { vi.restoreAllMocks() })
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); delete Range.prototype.getClientRects; document.body.innerHTML = '' })

it('behaves exactly like the original on two hundred scripted sessions', async () => {
  const flavours = [{}, { rtl:true, page:true }, { scrolled:true }, { reduced:true, links:true }, { noMatchMedia:true, coverFails:true, noRects:true }, { cover:'blob' }]
  const seen = { attributes:0, turns:0, relocations:0, searches:0, hits:0, overlays:0, followed:0, boxes:0 }
  for (let seed = 1; seed <= 200; seed++) {
    const flavour = flavours[seed % flavours.length]
    const expected = await run(ReferenceFoliateReader, 900 + seed, flavour)
    const actual = await run(FoliateReader, 900 + seed, flavour)
    expect(actual).toEqual(expected)
    const last = expected.at(-2)
    seen.attributes += last.log.filter(([name]) => name === 'attr').length
    seen.turns += last.log.filter(([name, what]) => (name === 'next' || name === 'prev') && what === 'start').length
    seen.relocations += last.relocations.length
    seen.searches += last.log.filter(([name]) => name === 'search').length
    seen.hits += expected.filter(step => step.value?.length > 100).length
    seen.overlays += last.log.filter(([name]) => name === 'overlay.add').length
    seen.followed += last.log.filter(([name]) => name === 'goTo' || name === 'scrollToAnchor').length
    seen.boxes += last.log.filter(([name, key, value]) => name === 'attr' && key === 'max-block-size' && value !== undefined).length
  }
  // The corpus has to reach the paths it claims to compare.
  expect(seen.attributes).toBeGreaterThan(1000)
  expect(seen.turns).toBeGreaterThan(300)
  expect(seen.relocations).toBeGreaterThan(100)
  expect(seen.searches).toBeGreaterThan(50)
  expect(seen.overlays).toBeGreaterThan(20)
  expect(seen.boxes).toBeGreaterThan(100)
}, 240000)

it('page box heights, remembered boxes and the search outline match the original', () => {
  let state = 31337
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296 }
  const memory = () => { const data = new Map(); return { getItem:key => data.get(key) ?? null, setItem:(key, value) => data.set(key, String(value)) } }
  const throwing = { getItem() { throw Error('denied') }, setItem() { throw Error('denied') } }
  for (let session = 0; session < 200; session++) {
    const a = memory(), b = memory(), mode = ['memory', 'none', 'throwing'][session % 3]
    const storageFor = which => mode === 'memory' ? which : mode === 'none' ? null : throwing
    if (session % 5 === 0) for (const storage of [a, b]) storage.setItem('inhouse-read-page-boxes-v3', JSON.stringify([{ width:390, target:700, height:690 }, { bad:true }, null, { width:'x', target:1, height:2 }]))
    for (let step = 0; step < 30; step++) {
      const input = { width:random() > .1 ? 300 + Math.floor(random() * 700) + (random() > .8 ? .4 : 0) : NaN, space:random() > .05 ? 200 + random() * 900 : NaN, free:random() * 1000 }
      const expected = referencePageHeight({ ...input, storage:storageFor(a) })
      const actual = rustUI.page_box_height(input.width, input.space, input.free, storageFor(b), undefined)
      if (mode === 'memory') expect(b.getItem('inhouse-read-page-boxes-v3')).toBe(a.getItem('inhouse-read-page-boxes-v3'))
      expect(Object.is(actual, expected) || (Number.isNaN(actual) && Number.isNaN(expected))).toBe(true)
    }
  }
  const draw = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  for (const rects of [[], [{ left:1, top:2, width:3, height:4 }], Array.from({ length:9 }, (_, i) => ({ left:i * 3.3, top:i, width:10 + i, height:12.5 }))]) {
    for (const options of [undefined, {}, { color:'#123456' }]) {
      const text = node => new XMLSerializer().serializeToString(node)
      expect(text(rustOutline(rects, options))).toBe(text(referenceOutline(rects, options)))
    }
  }
  expect(draw).toBeTruthy()
})
