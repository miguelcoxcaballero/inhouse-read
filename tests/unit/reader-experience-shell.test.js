// The constructor of the reading experience, and its jump and step, are rust-ui (experience_shell.rs,
// experience_methods.rs). This differential builds the frozen JavaScript class and the production one over the
// same page and compares what each leaves behind: the own properties in order, every listener and observer it
// registered, the document, and what its callbacks do when the page invokes them.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import * as rustUI from '../../src/wasm/ui/inhouse_read_ui.js'
import { ReaderExperience } from '../../src/js/readers/reader-experience.js'
import { ReferenceReaderExperience } from './helpers/reference-reader-experience-shell.js'

const log = vi.hoisted(() => ({ events:[] }))
vi.mock('../../src/js/readers/reading-voice.js', () => ({
  ReadingVoice:class {
    state = 'stopped'; browsing = false
    constructor(reader, onState) { this.reader = reader; this.onState = onState; log.events.push(['voice', typeof onState, onState.length >= 0]) }
    stop() {}
    browse() { log.events.push(['browse']) }
    continueFromPage(navigate) { log.events.push(['continue']); return navigate?.() }
  }
}))
vi.mock('../../src/js/rust-ui.js', () => ({ getRustUI:() => rustUI }))
vi.mock('../../src/js/readers/neural-runtime.js', () => ({ loadNeural:async () => null, neuralEngine:() => null, neuralVoiceList:() => [] }))
beforeAll(() => rustUI.initSync({ module:readFileSync('src/wasm/ui/inhouse_read_ui_bg.wasm') }))

const page = '<header class="app-header"></header><section id="reader-screen"><div id="reader-toolbar"></div>' +
  ['reader-location', 'reader-settings', 'reader-audio', 'reader-save-bookmark', 'reader-search-shortcut', 'reader-more-shortcut', 'reader-top-title', 'reader-top-byline']
    .map(id => `<button id="${id}">${id === 'reader-location' ? '<span class="reader-location-label"></span>' : ''}</button>`).join('') + '</section>'
const parts = ['chrome', 'lifecycle', 'voiceFlow', 'preferenceFlow', 'actions']
const flush = async () => { for (let n = 0; n < 12; n++) await Promise.resolve() }
// Menu ids come from one counter of the module; everything else must be the same text.
const markup = () => document.body.innerHTML.replace(/select-menu-\d+/g, 'select-menu-N')

async function run(Class, { weakRef = true, observers = true, viewport = true } = {}) {
  log.events = []
  const events = log.events, added = []
  document.body.innerHTML = page
  localStorage.clear()
  vi.stubGlobal('requestIdleCallback', callback => { callback(); return 0 })
  if (!weakRef) vi.stubGlobal('WeakRef', undefined)
  const made = []
  vi.stubGlobal('ResizeObserver', observers ? class { constructor(callback) { this.callback = callback; made.push(this); events.push(['observer', typeof callback]) } observe(node) { events.push(['observe', node.className || node.id || node.tagName]) } disconnect() {} } : undefined)
  const visual = viewport ? { addEventListener:(type, callback) => { added.push(['viewport', type]); visual[type] = callback }, height:500, offsetTop:0 } : undefined
  Object.defineProperty(window, 'visualViewport', { value:visual, configurable:true })
  const targets = [[document, 'document'], [window, 'window']]
  const spies = targets.map(([target, name]) => vi.spyOn(target, 'addEventListener').mockImplementation(function (type, callback) { added.push([name, type, typeof callback]); (target.__handlers ||= {})[type] = callback }))
  const reader = { location:{ locator:{ kind:'cfi', value:'here' }, fraction:.25 }, format:{ engine:'foliate' }, toc:[], pageCount:null, epoch:1,
    applyPreferences:async () => {}, getSelection:() => ({ text:'chosen', locator:{ kind:'cfi', value:'sel' } }),
    next:async () => { events.push(['next']) }, prev:async () => { events.push(['prev']) },
    goToLocator:async (...args) => { events.push(['locator', ...args]) }, goToTarget:async target => { events.push(['target', target]) } }
  const persist = async (...args) => { events.push(['persist', args[0]]) }, onLengthMetadata = async () => {}
  const experience = new Class(reader, { persist, onLengthMetadata })
  for (const spy of spies) spy.mockRestore()
  const result = { keys:Object.keys(experience), added:[...added], constructed:[...events], html:markup(),
    same:[experience.reader === reader, experience.persist === persist, experience.onLengthMetadata === onLengthMetadata, experience.voice.reader === reader],
    // The five parts were instances of five classes and are objects rust-ui builds (reader-parts.test.js compares them).
    types:Object.fromEntries(Object.keys(experience).map(key => [key, parts.includes(key) ? 'part' : experience[key]?.constructor?.name ?? String(experience[key])])) }
  // The callbacks the constructor handed out, invoked as the page invokes them.
  events.length = 0
  // An observer writes the height of what it watches where the layout reads it (the view's own method).
  const style = experience.screen.style, heights = ['--reader-audio-height', '--reader-return-height']
  result.observed = made.map((observer, index) => { heights.forEach(name => style.setProperty(name, 'unset')); observer.callback([], observer); return [index, ...heights.map(name => style.getPropertyValue(name))] })
  window.__handlers['inhouse-reader-selection']({ detail:{ text:'', locator:1 } })
  result.emptySelection = experience.selectedQuoteSelection
  window.__handlers['inhouse-reader-selection']({ detail:{ text:'quote', locator:2 } })
  result.selection = experience.selectedQuoteSelection
  experience.selectedQuoteSelection = null
  document.getElementById('reader-settings').focus()
  document.__handlers.selectionchange(new Event('selectionchange'))
  result.changed = experience.selectedQuoteSelection
  await experience.open({ id:'book', title:'Book', wordCount:21600, wordCountComplete:true, readingHistory:[{ locator:{ kind:'cfi', value:'back' }, fraction:.1 }] })
  experience.panel.close = () => events.push(['close'])
  experience.voice.state = 'playing'
  experience.voice.onState('playing', 'Leyendo')
  result.afterState = markup()
  const metrics = vi.spyOn(rustUI, 'experience_method')
  result.progress = experience.voice.onProgress()
  metrics.mockRestore()
  const updated = vi.spyOn(experience.view, 'updateReadingMetrics')
  experience.voice.onProgress()
  result.progressCalls = updated.mock.calls.length
  const chooseLanguage = vi.spyOn(experience.voiceFlow, 'chooseLanguage'), set = vi.spyOn(experience.preferenceFlow, 'set')
  for (const option of document.querySelectorAll('.select-menu [role="option"]')) option.click()
  result.menus = [chooseLanguage.mock.calls, set.mock.calls]
  result.deref = experience.controls ? 'controls' : 'none'
  // Each resize reads whether the panel is open, once (the chrome's own resize, however it is reached).
  let reads = 0
  Object.defineProperty(experience.panel, 'open', { get:() => { reads++; return false }, configurable:true })
  result.resize = [experience.resizePanel(new Event('resize')), visual?.resize?.(new Event('resize')), visual?.scroll?.(new Event('scroll')), window.__handlers.resize(new Event('resize'))]
  result.resizeReads = reads
  delete experience.panel.open
  events.length = 0
  await experience.jump({ locator:{ kind:'cfi', value:'there' }, fraction:.8 })
  await experience.jump(null, 'chapter.xhtml')
  await experience.step(1); await experience.step(-1); await experience.step(0)
  await experience.returnToReading()
  await flush()
  result.navigation = [...events]
  result.history = JSON.parse(JSON.stringify(experience.history, (key, value) => key === 'createdAt' ? 0 : value))
  result.end = markup()
  return result
}

let warmed = false
describe('the reading experience built by Rust', () => {
  beforeEach(() => { vi.spyOn(Date, 'now').mockReturnValue(1234) })
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = ''; delete window.__handlers; delete document.__handlers })
  it.each([
    ['every browser doorway', {}],
    ['no WeakRef', { weakRef:false }],
    ['no ResizeObserver', { observers:false }],
    ['no visual viewport', { viewport:false }],
    ['none of them', { weakRef:false, observers:false, viewport:false }],
  ])('leaves the page the JavaScript constructor left: %s', async (_, options) => {
    // The module installs a few document listeners of its own the first time a panel is built: not the constructor's.
    if (!warmed) { warmed = true; await run(ReaderExperience, options) }
    const reference = await run(ReferenceReaderExperience, options)
    const rust = await run(ReaderExperience, options)
    expect(rust).toEqual(reference)
    expect(rust.keys).toEqual(reference.keys)
    expect(rust.keys).toContain('resizePanel')
    expect(rust.selection).toEqual({ text:'quote', locator:2 })
    expect(rust.navigation.length).toBeGreaterThan(4)
    expect(rust.resizeReads).toBe(options.viewport === false ? 2 : 4)
  })
  it('answers jump and step from the dispatcher, not from the class body', () => {
    const source = readFileSync('src/js/readers/reader-experience.js', 'utf8')
    expect(source).not.toMatch(/addEventListener|ResizeObserver|WeakRef/)
    expect(source).not.toMatch(/new Reader(Chrome|Lifecycle|Actions)|new (Voice|Preference)Flow|RustReaderNavigation/)
    expect(Object.getOwnPropertyNames(ReaderExperience.prototype)).toEqual(expect.arrayContaining(['jump', 'step', 'open']))
  })
})
