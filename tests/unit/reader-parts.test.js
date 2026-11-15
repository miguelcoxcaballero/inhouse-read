// The five parts of the reading experience (chrome, lifecycle, voice flow, preference flow, actions) were
// JavaScript classes and are objects rust-ui builds (experience_parts.rs `reader_part`). This differential builds a
// part both ways over the same recording host and compares what a caller can observe: its fields, what each
// method answers and when (the microtask a promise settles on), what it does to the host, and the three callbacks
// that were JavaScript arrows of preference-flow.js and voice-flow.js (normalize, store, the device's language).
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import * as rustUI from '../../src/wasm/ui/inhouse_read_ui.js'
import { partsKit, referenceParts } from './helpers/reference-reader-parts.js'
import { normalizeReadingPreferences, DEFAULT_READING_PREFERENCES, RATE_STEPS } from '../../src/js/readers/reading-preferences.js'

const cloud = vi.hoisted(() => ({ changed:[] }))
vi.mock('../../src/js/rust-ui.js', () => ({ getRustUI:() => rustUI }))
vi.mock('../../src/js/cloud-settings.js', () => ({ notifyCloudSettingsChanged:(...args) => { cloud.changed.push(args) } }))
const engine = vi.hoisted(() => ({ released:0 }))
vi.mock('../../src/js/readers/neural-runtime.js', () => ({ loadNeural:async () => null, neuralEngine:() => ({ release:() => { engine.released++ } }),
  neuralVoiceList:() => [{ id:'piper:en_GB-alba-medium', name:'Alba', lang:'en-GB', base:'en', installed:true, neural:true, quality:'medium' }] }))
beforeAll(() => rustUI.initSync({ module:readFileSync('src/wasm/ui/inhouse_read_ui_bg.wasm') }))
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = ''; localStorage.clear(); cloud.changed.length = 0 })

const build = { reference:(host, which) => new referenceParts[which](host), rust:(host, which) => rustUI.reader_part(host, which, partsKit, rustUI) }
const own = part => Object.keys(part).filter(key => typeof part[key] !== 'function' || ['reveal', 'place', 'fields', 'quote'].includes(key))
// The microtask on which a promise settles, counted from the call that made it.
async function settledAt(make) {
  let tick = 0, at = null, value
  const counting = (async () => { while (at === null && tick < 40) { await null; tick++ } })()
  let promise
  try { promise = make() } catch (error) { return { thrown:String(error?.message ?? error) } }
  if (!(promise instanceof Promise)) return { value:promise }
  await promise.then(result => { at = tick; value = result }, error => { at = tick; value = `rejected:${error?.message ?? error}` })
  await counting
  return { promise:true, at, value }
}

function recordingHost(events) {
  document.body.innerHTML = '<section id="reader-screen"><header id="reader-toolbar"><button id="reader-settings"></button><button id="reader-location"></button><button id="reader-audio"></button></header></section>'
  const reader = { format:{ engine:'foliate' }, location:{ locator:{ kind:'cfi', value:'here' }, fraction:.25 },
    applyPreferences:async value => { events.push(['reader.apply', value.theme]) }, getSelection:() => null, search:async query => [{ locator:query, fraction:.5 }],
    goToLocator:async (...args) => { events.push(['locator', ...args]) }, goToTarget:async target => { events.push(['target', target]) } }
  const host = { reader, book:{ id:'book', language:'es-ES' }, history:[], bookmarks:[], quotes:[], location:reader.location, quoteColor:'green', selectedQuoteSelection:null,
    preferences:{ ...DEFAULT_READING_PREFERENCES },
    voice:{ stop:() => events.push(['voice.stop']), browse:() => events.push(['browse']), retryNeural:() => events.push(['retry']), restart:() => events.push(['restart']) },
    view:{ applyPreferences:(p, theme, pdf) => events.push(['view.apply', p.theme, theme?.scheme, pdf]) },
    lists:{ clearSearch:message => events.push(['searchStatus', message]), renderSearch:(results, activate) => { events.push(['results', results.length, typeof activate]); host.activate = activate } },
    neuralPicker:{ render:() => events.push(['picker.render']), warmUp:() => events.push(['picker.warm']) },
    label:() => 'Here', error:message => events.push(['error', message]), persist:async (id, fields) => { events.push(['persist', id, Object.keys(fields)]) },
    applyPreferences:update => events.push(['apply', update]), updateMiniPlayer:(...args) => events.push(['mini', ...args]), updateReturnButton:() => events.push(['back']),
    setSleepChoice:value => events.push(['sleep', value]), relocate:() => events.push(['relocate']), renderPlaces:() => events.push(['render']),
    showPlaceTab:tab => events.push(['tab', tab]), jump:place => events.push(['jump', place]), returnToReading:() => 'reading' }
  host.savePlaces = () => host.actionsPart?.savePlaces()
  return host
}
// What the lifecycle and the voice flow reach besides: the chrome's DOM, and every other method of the experience,
// its view and its menus as a recorder.
function fullHost(events) {
  const host = recordingHost(events), recorder = name => new Proxy({}, { get:(target, key) => typeof key === 'string' ? (...args) => { events.push([`${name}.${key}`, args.length]) } : undefined })
  rustUI.reader_chrome_create(host, RATE_STEPS, document)
  host.panel.showModal = () => events.push(['showModal']); host.panel.close = () => events.push(['close'])
  for (const name of ['cancelNavigation', 'renderToc', 'endSearch', 'syncReturnLayout', 'showTab', 'populateVoices', 'resizePanel', 'updateReadingMetrics'])
    host[name] = (...args) => { events.push([name, ...args]) }
  host.setPreference = (key, value, options) => { events.push(['setPreference', key, value, options]); host.preferences = { ...host.preferences, [key]:value } }
  host.bookLanguage = () => host.reader.language || 'es-ES'
  Object.assign(host, { view:recorder('view'), languageMenu:recorder('languageMenu'), voiceMenu:recorder('voiceMenu') })
  Object.assign(host.neuralPicker, { cancelWarm:() => events.push(['picker.cancel']), refresh:() => events.push(['picker.refresh']) })
  host.reader.addQuoteAnnotation = quote => events.push(['annotation', quote.text]); host.reader.pageCount = 12
  host.voiceCatalog = { voices:[{ id:'v', installed:true, base:'en', neural:true, lang:'en-GB' }] }
  return host
}

// One script per part: every method, with the arguments the experience gives it.
const scripts = {
  chrome:async (part, host) => {
    const out = [part.create(), Object.keys(host)]
    host.panel.showModal?.(); const raf = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(callback => { out.push(['frame', callback === part.reveal]); return 1 })
    out.push(part.resize(new Event('resize')))
    Object.defineProperty(host.panel, 'open', { value:true, configurable:true })
    out.push(part.resize(new Event('resize')), host.panel.style.maxHeight, host.panel.style.bottom, part.reveal())
    raf.mockRestore()
    out.push(part.voiceState('playing', 'Leyendo'), part.voiceState('stopped', ''), host.panel.querySelector('.reading-audio-status').textContent)
    return out
  },
  lifecycle:async (part, host) => {
    const attempt = run => { try { return run() } catch (error) { return `threw:${error?.message ?? error}` } }
    const record = { id:'b', title:'T', author:'A', bookmarks:[{ locator:{ kind:'cfi', value:'m' }, fraction:.5 }], quotes:[{ text:'q', locator:{ kind:'cfi', value:'q' } }], readingHistory:[] }
    const out = [await settledAt(() => part.open(record)), host.book === record, host.bookmarks.length, host.quotes.length, await settledAt(() => part.open(null))]
    host.book = record
    out.push(attempt(() => part.refreshNames('other', { title:'No' })), attempt(() => part.refreshNames('b', { title:'New' })), record.title, attempt(() => part.closeVoice()))
    out.push(attempt(() => part.show('audio')), attempt(() => part.show('places')), attempt(() => part.reset()), host.book, host.returnButton.hidden)
    host.applyPreferences = () => Promise.reject(new Error('no preferences'))
    out.push(await settledAt(() => part.open(record)))
    return out
  },
  voices:async (part, host) => {
    const attempt = run => { try { return run() } catch (error) { return `threw:${error?.message ?? error}` } }
    vi.stubGlobal('navigator', { language:'pt-BR' })
    const out = [part.bookLanguage(), (host.reader.language = 'fr-FR', part.bookLanguage()), attempt(() => part.voiceBase(host.voiceCatalog.voices))]
    host.preferences.voice = 'v'
    out.push(attempt(() => part.voiceBase(host.voiceCatalog.voices)), attempt(() => part.chooseLanguage('en')), attempt(() => part.chooseLanguage('de')), attempt(() => part.chooseLanguage('')))
    host.preferences.voiceLang = 'it'
    out.push(attempt(() => part.voiceBase([])), attempt(() => part.populateVoices()), attempt(() => part.voiceBase()))
    return out
  },
  preferences:async (part, host) => {
    const out = [part.set('theme', 'night', true), host.preferences.theme, part.set('rate', 1.5, 1), part.set('voice', 'x', 0), part.set('fontSize', 22)]
    out.push(await settledAt(() => part.apply(true)), await settledAt(() => part.apply(false)), await settledAt(() => part.apply()), localStorage.getItem('inhouse-read-reading-preferences'), JSON.stringify(cloud.changed))
    host.reader.applyPreferences = () => { throw new Error('no reader') }
    out.push(await settledAt(() => part.apply(1)))
    host.view = null
    out.push(await settledAt(() => part.apply(true)))
    return out
  },
  actions:async (part, host) => {
    host.actionsPart = part
    const out = [JSON.stringify(part.place(), (key, value) => key === 'createdAt' ? 0 : value), Object.keys(part.fields()), part.quote('text', { kind:'cfi', value:'q' })?.text]
    out.push(await settledAt(() => part.savePlaces()), await settledAt(() => part.jump({ locator:{ kind:'cfi', value:'there' }, fraction:.8 }, undefined, () => true)))
    out.push(await settledAt(() => part.jump(null, 'chapter.xhtml', () => false)), await settledAt(() => part.addBookmark()), await settledAt(() => part.addQuote()))
    host.selectedQuoteSelection = { text:'quoted', locator:{ kind:'cfi', value:'sel' } }; host.reader.addQuoteAnnotation = quote => { host.annotated = quote.text }
    out.push(await settledAt(() => part.addQuote()), host.annotated, host.quotes.length)
    out.push(await settledAt(() => part.search('needle')), host.activate({ locator:'needle' }), host.searchActive, await settledAt(() => part.endSearch()), host.searchActive)
    out.push(await settledAt(() => part.returnToReading(host.history[0], () => true)), host.history.length)
    return out
  },
}

describe.each(Object.keys(scripts))('the %s part built by Rust', which => {
  it('has the fields, answers and effects of the JavaScript class', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1234)
    const results = {}
    for (const engine of ['reference', 'rust']) {
      const events = [], host = (which === 'lifecycle' || which === 'voices' ? fullHost : recordingHost)(events), part = build[engine](host, which)
      localStorage.clear(); cloud.changed.length = 0
      const answers = await scripts[which](part, host)
      results[engine] = { own:own(part), sameHost:part.host === host, answers, events:JSON.parse(JSON.stringify(events, (key, value) => key === 'createdAt' ? 0 : value)), html:document.body.innerHTML }
    }
    if (process.env.PARTS_DEBUG) console.log(which, JSON.stringify({ answers:results.rust.answers, events:results.rust.events }))
    expect(results.rust).toEqual(results.reference)
    expect(results.rust.events.length).toBeGreaterThan(4)
  })
})

describe('the callbacks that were arrows of the flows', () => {
  it('normalizes a changed preference like { ...current, [key]: value }', () => {
    const reference = (current, key, value) => normalizeReadingPreferences({ ...current, [key]: value })
    const cases = [[DEFAULT_READING_PREFERENCES, 'theme', 'night'], [{ ...DEFAULT_READING_PREFERENCES, rate:2 }, 'rate', 0.5], [null, 'fontSize', 30], [undefined, 'voice', 'v'],
      ['ab', 'theme', 'sepia'], [{ theme:'sage' }, '__proto__', { theme:'night' }], [{ theme:'sage' }, 'zoom', NaN], [Object.create({ theme:'night' }), 'pdfMode', 'text'], [{ theme:'sage' }, 7, 1]]
    for (const [current, key, value] of cases) expect(rustUI.reader_part_normalize(partsKit, current, key, value), String(key)).toEqual(reference(current, key, value))
    // The object handed to the normalizer has the same own keys, in the same order, and no changed prototype.
    const seen = [], kit = { preferences:{ normalizeReadingPreferences:value => { seen.push([Object.keys(value), Object.getPrototypeOf(value) === Object.prototype]); return value } } }
    rustUI.reader_part_normalize(kit, { b:1, a:2 }, 'c', 3); rustUI.reader_part_normalize(kit, { b:1, a:2 }, 'b', 9); rustUI.reader_part_normalize(kit, { a:1 }, '__proto__', { x:1 })
    expect(seen).toEqual([[['b', 'a', 'c'], true], [['b', 'a'], true], [['a', '__proto__'], true]])
  })
  it('stores the preferences and reads the device language like the arrows did', () => {
    const KEY = 'inhouse-read-reading-preferences', reference = value => localStorage.setItem(KEY, JSON.stringify(value))
    for (const value of [{ theme:'night', rate:1.25 }, [1, 'two'], 'text', 3, null, undefined, { toJSON:() => ({ made:true }) }]) {
      localStorage.clear(); reference(value); const expected = localStorage.getItem(KEY)
      localStorage.clear(); rustUI.reader_part_store(value)
      expect(localStorage.getItem(KEY)).toBe(expected)
    }
    const circular = {}; circular.self = circular
    expect(() => rustUI.reader_part_store(circular)).toThrow(TypeError)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError') })
    expect(() => rustUI.reader_part_store({})).toThrow('full')
    vi.restoreAllMocks()
    for (const language of ['es-ES', '', undefined]) {
      vi.stubGlobal('navigator', { language })
      expect(rustUI.reader_part_device()).toBe(navigator.language)
    }
  })
})
