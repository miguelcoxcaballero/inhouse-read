import './helpers/rust-ui-ready.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReaderExperience } from '../../src/js/readers/reader-experience.js'
import { ReaderExperience as Original } from './helpers/reference-reader-experience.js'

vi.mock('../../src/js/readers/reading-voice.js', () => ({
  ReadingVoice:class { state = 'stopped'; browsing = false; stop = vi.fn(); browse = vi.fn(); continueFromPage = vi.fn(async navigate => navigate?.()) }
}))
vi.mock('../../src/js/readers/neural-runtime.js', () => ({ loadNeural:async () => null, neuralEngine:() => null, neuralVoiceList:() => [] }))

// The compiled experience is compared with the frozen original: the same scripted session is played on each in a
// fresh page and everything either leaves behind (the DOM, its own state, every call it made on its collaborators)
// has to be equal. The page numbers its menus across instances, so those counters are masked.
let seed = 99173
const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296)
const pick = list => list[Math.floor(random() * list.length)]
const FIXTURE = '<header class="app-header"></header><section id="reader-screen"><div id="reader-toolbar"></div></section>'
const BUTTONS = ['reader-location', 'reader-settings', 'reader-audio', 'reader-save-bookmark', 'reader-search-shortcut', 'reader-more-shortcut', 'reader-top-title', 'reader-top-byline']
const mask = text => text.replace(/\b(id|for|aria-controls|aria-labelledby|aria-owns|aria-activedescendant|name)="([^"]*?)\d+([^"]*)"/g, '$1="$2#$3"').replace(/"createdAt":\d+/g, '"createdAt":0')
const masked = value => JSON.parse(JSON.stringify(value), (key, item) => typeof item === 'string' ? mask(item) : key === 'createdAt' ? 0 : item)

function page() {
  document.body.innerHTML = FIXTURE
  for (const id of BUTTONS) {
    const button = document.createElement('button')
    button.id = id
    if (id === 'reader-location') button.innerHTML = '<span class="reader-location-label"></span>'
    document.getElementById('reader-screen').append(button)
  }
}
function makeReader(extra = {}) {
  const calls = []
  const record = name => (...args) => { calls.push([name, ...args]); return Promise.resolve() }
  return { calls, location:{ fraction:0, locator:null }, format:{ engine:'foliate' }, toc:[], pageCount:null,
    applyPreferences:record('applyPreferences'), addQuoteAnnotation:record('addQuoteAnnotation'), removeQuoteAnnotation:record('removeQuoteAnnotation'),
    getSelection:() => null, next:record('next'), prev:record('prev'), goToLocator:record('goToLocator'), goToTarget:record('goToTarget'), ...extra }
}
async function play(Experience, preferences, script) {
  page(); localStorage.clear()
  if (preferences !== undefined) localStorage.setItem('inhouse-read-reading-preferences', preferences)
  vi.stubGlobal('requestIdleCallback', callback => { callback(); return 0 })
  const reader = makeReader(), persisted = []
  let outcome
  try {
    const experience = new Experience(reader, { persist:async (id, data) => { persisted.push([id, JSON.stringify(data)]) } })
    experience.panel.close = vi.fn(() => persisted.push(['panel.close']))
    outcome = await script(experience, reader, persisted)
  } catch (error) { outcome = { threw:String(error?.constructor?.name) } }
  const html = document.body.innerHTML
  vi.unstubAllGlobals()
  return masked({ outcome, html, calls:reader.calls.map(call => JSON.stringify(call)), persisted })
}
async function same(preferences, script) {
  const expected = await play(Original, preferences, script)
  const actual = await play(ReaderExperience, preferences, script)
  expect(actual).toEqual(expected)
  return actual
}

const FRACTIONS = [0, .001, .25, .333333, .5, .995, 1, -.2, 1.4, NaN, '0.5', undefined, null, 1e-9]
const SECTIONS = ['', 'Capítulo 1', 'Prólogo', undefined, null, 'Fin <b>', '😀 sección']
const PAGES = ['', '12', 'xii', undefined, 3]
function place() {
  const kind = random()
  return { fraction:pick(FRACTIONS), locator:kind < .3 ? null : kind < .65 ? { kind:'cfi', value:'epubcfi(/6/' + Math.floor(random() * 90) + ')' } : { kind:'pdf-page', value:pick([1, 7, 123, '9', 0]), textOffset:pick([undefined, 5]) },
    section:pick(SECTIONS), page:pick(PAGES), label:pick(['', undefined, 'Mi marcador', 'a'.repeat(50)]) }
}

describe('the compiled reading experience matches the original', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake:['setTimeout', 'clearTimeout'] }) })
  afterEach(() => { vi.useRealTimers() })

  it('builds itself from every kind of stored preference', async () => {
    for (const stored of [undefined, '', '{}', 'not json', '[]', 'null', '{"theme":"night","fontSize":99,"rate":1.3,"voice":"piper:nope"}', '{"theme":"__proto__","zoom":"x"}', '7', '{"fontWeight":600,"align":"justify","flow":"scrolled"}'])
      await same(stored, async experience => ({ preferences:experience.preferences, history:experience.history, location:experience.location, quoteColor:experience.quoteColor, selected:experience.selectedQuoteSelection }))
  })

  it('names places and sizes like the original', async () => {
    const places = Array.from({ length:300 }, place), counts = [null, undefined, 0, 12, 480, '30'], sizes = [undefined, null, 0, 1, 1023, 1024, 1536, 1048575, 1048576, 1572864, 5e9, '2048', 'x', NaN, -5, 1e21]
    await same(undefined, async (experience, reader) => {
      const names = []
      for (const count of counts) { reader.pageCount = count; for (const item of places) names.push(experience.label(item)) }
      return { names, sizes:sizes.map(size => experience.formatSize(size)), defaulted:experience.formatSize() }
    })
  })

  it('shows every relocation the same way', async () => {
    const steps = Array.from({ length:150 }, () => ({ location:place(), pageCount:pick([null, 0, 12, 480]) }))
    const marked = { ...place(), fraction:.5, locator:{ kind:'cfi', value:'epubcfi(/6/10)' } }
    const result = await same(undefined, async (experience, reader) => {
      await experience.open({ id:'book-a', title:'Libro', format:'PDF', readingHistory:[], bookmarks:[structuredClone(marked)] })
      const seen = []
      for (const step of steps) {
        reader.location = step.location; reader.pageCount = step.pageCount
        experience.relocate()
        seen.push([JSON.stringify(experience.location), document.querySelector('.reader-location-label')?.textContent, document.getElementById('reader-save-bookmark').getAttribute('aria-pressed')])
      }
      return seen
    })
    expect(result.outcome.length).toBe(150)
  })

  it('shows the audiobook in the mini player and the return button', async () => {
    const states = ['playing', 'paused', 'loading', 'stopped', undefined, '', 'error', null]
    const opened = [place(), place()], histories = [[], [place()], [{ ...place(), label:'' }, place()], [{ ...place(), label:'Etiqueta' }]]
    await same(undefined, async experience => {
      await experience.open({ id:'book-a', title:'Libro de <prueba>', author:'Autora', format:'EPUB', readingHistory:structuredClone(opened) })
      const seen = []
      for (const rate of [0.75, 1, 1.25, 1.5, 2]) {
        experience.preferences = { ...experience.preferences, rate }
        for (const state of states) for (const message of ['', 'Cargando voz', 'x'.repeat(80)]) {
          experience.updateMiniPlayer(state, message)
          seen.push(document.querySelector('.reading-mini-player')?.innerHTML)
        }
      }
      experience.voice.state = 'paused'; experience.updateMiniPlayer()
      experience.book = null; experience.updateMiniPlayer('playing', 'sin libro')
      seen.push(document.querySelector('.reading-mini-player')?.innerHTML)
      for (const browsing of [true, false, undefined]) {
        experience.voice.browsing = browsing
        for (const history of histories) {
          experience.history = structuredClone(history); experience.updateReturnButton()
          seen.push(document.querySelector('.reader-return')?.outerHTML)
        }
      }
      return seen
    })
  })

  it('draws the lists of places and removes one like the original', async () => {
    const lists = { history:Array.from({ length:5 }, place), bookmarks:Array.from({ length:7 }, place), quotes:Array.from({ length:4 }, () => ({ ...place(), text:'una cita', color:'blue' })) }
    const result = await same(undefined, async (experience, reader, persisted) => {
      await experience.open({ id:'book-a', title:'Libro', readingHistory:[], bookmarks:[], quotes:[] })
      experience.history = structuredClone(lists.history); experience.bookmarks = structuredClone(lists.bookmarks); experience.quotes = structuredClone(lists.quotes)
      experience.renderPlaces()
      const html = () => [...document.querySelectorAll('.reading-panel [data-places], .reading-panel [data-history], .reading-panel [data-bookmarks], .reading-panel [data-quotes]')].map(node => node.innerHTML)
      const seen = [html(), document.querySelector('.reading-panel')?.innerHTML]
      for (const [name, selector] of [['history', '[data-history]'], ['bookmarks', '[data-bookmarks]'], ['quotes', '[data-quotes]']]) {
        const remove = document.querySelector(`.reading-panel ${selector} .reading-place button[aria-label^="Eliminar"]`)
        if (remove) { remove.click(); await vi.advanceTimersByTimeAsync(0); await Promise.resolve(); seen.push([name, document.querySelector('.reading-panel')?.innerHTML]) }
      }
      return { seen, persisted, counts:[experience.history.length, experience.bookmarks.length, experience.quotes.length] }
    })
    // One row of each list was really removed and saved (the test would otherwise compare nothing).
    expect(result.outcome.counts).toEqual([4, 6, 3])
    expect(result.calls.filter(call => call.startsWith('["removeQuoteAnnotation"')).length).toBe(1)
  })

  it('shows the table of contents or falls back to the bookmarks', async () => {
    const toc = [{ label:'Uno', href:'a.xhtml' }, { label:'Dos', href:'b.xhtml', subitems:[{ label:'Dos.1', href:'b1.xhtml' }] }]
    for (const items of [toc, [], undefined]) {
      const result = await same(undefined, async (experience, reader) => {
        reader.toc = items
        await experience.open({ id:'book-a', title:'Libro', readingHistory:[] })
        const link = document.querySelector('.reading-panel [data-toc] button, .reading-panel [data-toc] a')
        link?.click(); await vi.advanceTimersByTimeAsync(0)
        return { panel:document.querySelector('.reading-panel')?.innerHTML, targets:reader.calls }
      })
      // A link of the table of contents really leads somewhere (the comparison above is not empty).
      if (items === toc) expect(result.calls.some(call => call.startsWith('["goToTarget"'))).toBe(true)
    }
  })

  it('reports errors in the panel and switches tabs like the original', async () => {
    await same(undefined, async (experience) => {
      const seen = []
      for (const text of ['', 'No se pudo abrir.', 'x<y']) { experience.error(text); seen.push(document.querySelector('.reading-error').textContent) }
      for (const tab of ['search', 'audio', 'places', 'settings', 'toc']) { experience.showTab(tab); seen.push([tab, document.querySelector('.reading-panel').innerHTML.length]) }
      for (const name of ['toc', 'bookmarks', 'history', 'quotes']) { experience.showPlaceTab(name); seen.push([experience.placeTab, document.querySelector('.reading-panel').innerHTML.length]) }
      return seen
    })
  })

  it('resets the appearance but keeps what is said aloud', async () => {
    await same('{"theme":"night","fontSize":30,"rate":1.5,"voice":"piper:x","voiceLang":"es"}', async (experience, reader) => {
      await experience.open({ id:'book-a', title:'Libro', readingHistory:[] })
      experience.resetAppearance(); await Promise.resolve()
      return { preferences:experience.preferences, applied:reader.calls.length }
    })
  })

  it('remembers a selection from the page and from the engine alike', async () => {
    await same(undefined, async (experience, reader) => {
      const seen = []
      for (const detail of [{ text:'hola', locator:{ kind:'cfi', value:'x' } }, { text:'' }, null, undefined, { text:'otra' }, {}]) {
        window.dispatchEvent(new CustomEvent('inhouse-reader-selection', { detail }))
        seen.push(JSON.stringify(experience.selectedQuoteSelection))
      }
      for (const engine of ['texto suelto', { text:'objeto', locator:null }, '', null, { text:'' }]) {
        reader.getSelection = () => engine; reader.location = { fraction:.2, locator:{ kind:'cfi', value:'y' } }
        document.getElementById('reader-screen').append(Object.assign(document.createElement('input'), { id:'field' }))
        document.getElementById('field').focus()
        document.dispatchEvent(new Event('selectionchange'))
        seen.push(JSON.stringify(experience.selectedQuoteSelection))
      }
      return seen
    })
  })

  describe('sharing and rotating', () => {
    const book = extra => ({ id:'b', title:'Libro', format:'EPUB', mimeType:'application/epub+zip', content:new Blob(['abc'], { type:'application/epub+zip' }), ...extra })
    function stubs(mode) {
      const log = []
      class FakeFile { constructor(parts, name, options) { this.parts = parts; this.name = name; this.type = options.type; log.push(['File', name, options.type]) } }
      vi.stubGlobal('File', FakeFile)
      const share = mode === 'abort' ? async () => { throw Object.assign(new Error('x'), { name:'AbortError' }) } : mode === 'fail' ? async () => { throw new Error('boom') } : async data => { log.push(['share', data.title, data.files.length]) }
      vi.stubGlobal('navigator', mode === 'download' ? {} : { canShare:() => true, share })
      vi.stubGlobal('URL', { createObjectURL:file => { log.push(['create', file.name]); return 'blob:' + file.name }, revokeObjectURL:url => log.push(['revoke', url]) })
      return log
    }
    it('shares, downloads or reports like the original', async () => {
      for (const mode of ['share', 'abort', 'fail', 'download'])
        for (const extra of [{}, { fileName:'mi libro.epub' }, { format:undefined, title:'Sin formato' }, { format:'MOBI', mimeType:'' }, { content:undefined }, { content:null }])
          await same(undefined, async experience => {
            const log = stubs(mode)
            await experience.open({ id:'b', title:'Libro', readingHistory:[] })
            experience.book = book(extra)
            const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () { log.push(['click', this.href, this.download]) })
            await experience.shareBook(); await vi.advanceTimersByTimeAsync(31000)
            click.mockRestore()
            return { log, error:document.querySelector('.reading-error').textContent, closed:experience.panel.close.mock.calls.length }
          })
    })
    it('refuses to share without the original file or with a missing File class', async () => {
      await same(undefined, async experience => {
        vi.stubGlobal('File', undefined)
        await experience.open({ id:'b', title:'Libro', readingHistory:[] })
        experience.book = book()
        let failure
        try { await experience.shareBook() } catch (error) { failure = error.constructor.name }
        return failure
      })
    })
    it('rotates, or says why not', async () => {
      for (const orientation of [undefined, {}, { type:'portrait-primary', lock:async value => { orientation.locked = value } }, { type:'landscape-primary', lock:async value => { orientation.locked = value } }, { type:'x', lock:async () => { throw new Error('denied') } }, { lock:() => { throw new Error('sync') } }])
        await same(undefined, async experience => {
          const target = orientation && { ...orientation }
          if (target?.lock) { const lock = target.lock; target.lock = async value => { target.locked = value; return lock.call(target, value) } }
          vi.stubGlobal('screen', { orientation:target })
          const done = experience.rotateReading()
          const first = document.querySelector('.reading-error').textContent
          await done
          return { first, text:document.querySelector('.reading-error').textContent, locked:target?.locked }
        })
    })
  })
})
