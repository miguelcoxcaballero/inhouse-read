import './helpers/rust-ui-ready.js'
import { afterEach, expect, it, vi } from 'vitest'

const world = vi.hoisted(() => ({ log:[], shape:'full', engines:[], gate:null }))
const engine = kind => class {
  constructor() { this.index = world.engines.length; world.engines.push(this); this.name = `${kind}${this.index}`; world.log.push(['new', this.name])
    if (world.shape === 'bare') { for (const name of ['goToTarget', 'applyPreferences', 'getSpeechText', 'getSpeechSource', 'browseSpeech', 'returnToSpeech', 'stopSpeech', 'getNextSpeechSource',
      'getPageSnapshot', 'search', 'clearSearch', 'getSelection', 'addQuoteAnnotation', 'removeQuoteAnnotation', 'getCoverBlob', 'getLengthMetadata', 'goToFraction', 'goToCfi', 'goToPage']) this[name] = undefined } }
  async open(container, source, options) {
    this.options = options
    world.log.push(['open', this.name, source.constructor.name, Object.keys(options).join(), options.initialPage, options.initialFraction, options.preferences?.theme, options.initialLocator?.value])
    if (world.gate) await world.gate.promise
    if (world.shape === 'broken') throw new Error('engine failed')
  }
  close() { world.log.push(['close', this.name]) }
  async next(options) { world.log.push(['next', this.name, options]); if (world.shape === 'throwing') throw new Error('next failed') }
  async prev() { world.log.push(['prev', this.name]) }
  async goToFraction(value) { world.log.push(['goToFraction', this.name, value]) }
  async goToCfi(value) { world.log.push(['goToCfi', this.name, value]); if (world.shape === 'throwing') throw new Error('changed edition') }
  async goToPage(value, options) { world.log.push(['goToPage', this.name, value, options]) }
  async goToTarget(value) { world.log.push(['goToTarget', this.name, value]) }
  async applyPreferences(value) { world.log.push(['applyPreferences', this.name, value?.theme]) }
  async getSpeechText() { return world.shape === 'throwing' ? '' : `text of ${this.name}` }
  async getSpeechSource(options) { world.log.push(['getSpeechSource', this.name, options]); return world.shape === 'throwing' ? null : { text:'source', from:this.name } }
  browseSpeech() { world.log.push(['browse', this.name]) }
  returnToSpeech() { world.log.push(['return', this.name]); return Promise.resolve('returned') }
  stopSpeech() { world.log.push(['stop', this.name]) }
  getNextSpeechSource(options) { return { options, from:this.name, self:this } }
  async getPageSnapshot(options) { world.log.push(['snapshot', this.name, options]); return world.shape === 'throwing' ? null : { engine:kind, label:'page', location:world.shape === 'full' ? { fraction:.5 } : undefined } }
  async search(query) { return world.shape === 'throwing' ? null : [{ query, from:this.name }] }
  clearSearch() { world.log.push(['clearSearch', this.name]) }
  getSelection() { return world.shape === 'throwing' ? '' : { text:'sel' } }
  addQuoteAnnotation(quote) { world.log.push(['addQuote', this.name, quote?.id]) }
  removeQuoteAnnotation(quote) { world.log.push(['removeQuote', this.name, quote?.id]) }
  async getCoverBlob(options) { world.log.push(['cover', this.name, options?.retainOnClose]); if (world.gate2) await world.gate2.promise; if (world.shape === 'throwing') throw new Error('cover failed'); return new Blob(['x']) }
  async getLengthMetadata() { if (world.gate2) await world.gate2.promise; return world.shape === 'throwing' ? 0 : { words:12 } }
  get pageCount() { return world.shape === 'zero' ? 0 : 7 }
  get metadata() { return world.shape === 'meta' ? { language:['fr', 'de'], title:'T' } : world.shape === 'lang' ? { language:'it' } : world.shape === 'nolang' ? {} : { language:'es' } }
  get toc() { return world.shape === 'throwing' ? undefined : [{ label:'One' }] }
  get rtl() { return world.shape === 'meta' }
  get speechDiagnosticState() { return world.shape === 'full' ? { followPending:2, pageTurnPending:1, paginator:{ page:3 } } : world.shape === 'bare' ? undefined : { followPending:1 } }
}
vi.mock('../../src/js/readers/pdf-reader.js', () => ({ PdfReader:engine('pdf') }))
vi.mock('../../src/js/readers/foliate-reader.js', () => ({ FoliateReader:engine('foliate') }))
import { ReferenceReaderController } from './helpers/reference-reader-controller.js'
import { ReaderController } from '../../src/js/readers/reader-controller.js'

// The compiled controller is compared with the frozen original on scripted sessions against the
// same fake engines: every call the engines receive, every answer, every state getter.
const pdfBytes = new TextEncoder().encode('%PDF-1.7 body')
const zipBytes = Uint8Array.of(0x50, 0x4b, 3, 4, 0, 0)
const files = () => [new File([pdfBytes], 'book.pdf'), new File([zipBytes], 'book.epub'), new File([zipBytes], 'comic.cbz'), new File([new TextEncoder().encode('hello')], 'notes.txt'),
  new File([new Uint8Array(0)], 'late.azw3'), new File([pdfBytes], 'misnamed.epub'), new File([zipBytes], 'misnamed.pdf')]
const plain = value => JSON.parse(JSON.stringify(value, (key, item) => item instanceof Blob ? `blob:${item.size}` : item instanceof Error ? `error:${item.message}` : typeof item === 'function' ? 'function' : item === undefined ? '__undefined' : item))

async function run(Controller, seed, shape) {
  let state = seed * 2654435761 >>> 0
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296 }
  const pick = list => list[Math.floor(random() * list.length)]
  world.log.length = 0; world.engines.length = 0; world.shape = shape; world.gate = null; world.gate2 = null
  const controller = new Controller(), trace = [], relocations = []
  const container = document.createElement('div')
  const getters = () => ({ format:controller.format, epoch:controller.epoch, location:controller.location, speech:controller.speechPosition, diagnostic:controller.speechDiagnosticState,
    pageCount:controller.pageCount, language:controller.language, metadata:controller.metadata, toc:controller.toc, rtl:controller.rtl, next:typeof controller.getNextSpeechSource })
  const note = (name, value) => trace.push(plain({ name, value, getters:getters(), log:world.log }))
  const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
  const settled = async work => { try { return { ok:await work() } } catch (error) { return { threw:String(error?.message ?? error).replace(/^.* is not a function$/, 'a method is missing').replace(/^Cannot destructure.*$/, 'null options'), name:error?.constructor?.name } } }
  const operations = [
    async () => settled(() => controller.open(container, pick(files()), pick([undefined, {}, { initialPage:3 }, { initialLocator:{ kind:'pdf-page', value:2, textOffset:4 }, initialFraction:.3, preferences:{ theme:'night' } },
      { onFollowLink:() => {}, onToggleChrome:() => {} }, { onRelocate:record => relocations.push(record) }, null]))),
    async () => { const gate = world.gate = Promise.withResolvers(); const first = settled(() => controller.open(container, pick(files()), { onRelocate:record => relocations.push(record) })); await settle()
      const second = settled(() => controller.open(container, pick(files()))); gate.resolve(); world.gate = null; return [await first, await second] },
    async () => { const engineNow = world.engines.at(-1); const sample = pick([{ index:2, fraction:.4, cfi:'epubcfi(/6/2)', section:'S', page:'12' }, { index:0, fraction:2 }, { index:-1, fraction:-1, textOffset:5 }, { fraction:'x', index:1.5 },
      { index:4, textOffset:9 }, { index:'3', fraction:.25, cfi:'' }, {}]); engineNow?.options?.onRelocate?.(sample); return sample },
    async () => settled(() => controller.next(pick([undefined, { source:true }, { isActive:() => false }]))),
    async () => settled(() => controller.prev()),
    async () => settled(() => controller.goToFraction(pick([0, .5, 1, .333, 2, -1, undefined]))),
    async () => settled(() => controller.goToLocator(pick([{ kind:'cfi', value:'c1' }, { kind:'pdf-page', value:3 }, { kind:'pdf-page', value:3, textOffset:12 }, { kind:'pdf-page', value:3, textOffset:0 }, { kind:'x' }, null, undefined]), pick([undefined, .6, 0]))),
    async () => settled(() => controller.goToTarget(pick(['#a', { href:'b' }]))),
    async () => settled(() => controller.applyPreferences({ theme:pick(['paper', 'night']) })),
    async () => settled(() => controller.getSpeechText()),
    async () => settled(() => controller.getSpeechSource(pick([undefined, { visible:true }]))),
    async () => { controller.browseSpeech(); await controller.returnToSpeech(); controller.stopSpeech(); return 'speech' },
    async () => { const next = controller.getNextSpeechSource; const source = typeof next === 'function' ? next({ isActive:() => true }) : next; return source && { options:Object.keys(source.options ?? {}), from:source.from, bound:source.self === world.engines.at(-1) } },
    async () => settled(() => controller.getPageSnapshot(pick([undefined, { reuseSettledLayout:true }]))),
    async () => settled(async () => { const pending = controller.getPageSnapshot(); controller.close(); return await pending }),
    async () => settled(() => controller.search(pick(['query', '', undefined]))),
    async () => { controller.clearSearch(); return controller.getSelection() },
    async () => { controller.addQuoteAnnotation({ id:'q1' }); controller.removeQuoteAnnotation({ id:'q1' }); return 'quotes' },
    async () => { const controllerSignal = new AbortController(); return settled(() => controller.getCoverBlob(pick([undefined, {}, { signal:controllerSignal.signal }, { retainOnClose:true }]))) },
    async () => { const gate = world.gate2 = Promise.withResolvers(); const abort = new AbortController(); const cover = settled(() => controller.getCoverBlob({ signal:abort.signal, retainOnClose:random() > .5 }))
      const length = settled(() => controller.getLengthMetadata()); await settle(); const action = pick(['close', 'abort', 'reopen', 'none'])
      if (action === 'close') controller.close(); if (action === 'abort') abort.abort(); if (action === 'reopen') await settled(() => controller.open(container, pick(files())))
      gate.resolve(); world.gate2 = null; return [action, await cover, await length] },
    async () => settled(() => controller.getLengthMetadata()),
    async () => { controller.close(); return 'closed' }
  ]
  for (let step = 0; step < 24; step++) {
    const index = Math.floor(random() * operations.length)
    const result = await settled(() => operations[index]())
    await settle()
    note(`step${step}:${index}`, { result, relocations:relocations.length })
  }
  controller.close()
  note('end', relocations.slice(-3))
  return trace
}

afterEach(() => { world.gate = null; world.gate2 = null })

it('behaves exactly like the original on two hundred scripted sessions', async () => {
  const shapes = ['full', 'bare', 'throwing', 'broken', 'zero', 'meta', 'lang', 'nolang']
  const seen = { opens:0, failures:0, relocations:0, snapshots:0, covers:0, rejected:0, raced:0 }
  for (let seed = 1; seed <= 200; seed++) {
    const shape = shapes[seed % shapes.length]
    const reference = await run(ReferenceReaderController, seed, shape)
    const rust = await run(ReaderController, seed, shape)
    if (process.env.DEBUG_SEED == seed) { const dump = t => t.map(entry => entry.name + ' ' + JSON.stringify(entry.log.slice(-6))).join('\n'); process.stderr.write('REFERENCE\n' + dump(reference) + '\nRUST\n' + dump(rust) + '\n') }
    expect(rust.length, `seed ${seed}`).toBe(reference.length)
    for (let index = 0; index < reference.length; index++) {
      const strip = entry => JSON.parse(JSON.stringify(entry).replaceAll('Reference', ''))
      expect(strip(rust[index]), `seed ${seed} ${shape} note ${reference[index].name}`).toEqual(strip(reference[index]))
    }
    for (const entry of reference) {
      const result = entry.value?.result
      if (result?.ok?.ok?.engine && entry.name.endsWith(':0')) seen.opens++
      if (String(JSON.stringify(result)).includes('"threw"')) seen.failures++
      if (entry.name.endsWith(':2')) seen.relocations++
      if (entry.name.endsWith(':13') || entry.name.endsWith(':14')) seen.snapshots++
      if (entry.name.endsWith(':19')) seen.covers++
      if (entry.name.endsWith(':1') || entry.name.endsWith(':20')) seen.raced++
      if (String(JSON.stringify(result)).includes('Formato no soportado')) seen.rejected++
    }
  }
  if (process.env.DEBUG_SEEN) process.stderr.write(JSON.stringify(seen) + '\n')
  expect(seen.opens).toBeGreaterThan(40)
  expect(seen.failures).toBeGreaterThan(60)
  expect(seen.relocations).toBeGreaterThan(100)
  expect(seen.snapshots).toBeGreaterThan(80)
  expect(seen.covers).toBeGreaterThan(40)
  expect(seen.rejected).toBeGreaterThan(5)
  expect(seen.raced).toBeGreaterThan(30)
})
