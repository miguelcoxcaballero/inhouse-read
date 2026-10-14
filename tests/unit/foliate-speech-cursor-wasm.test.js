import './helpers/rust-ui-ready.js'
import { afterEach, expect, it, vi } from 'vitest'
import * as CFI from 'foliate-js/epubcfi.js'
import { Overlayer } from 'foliate-js/overlayer.js'
import { FoliateSpeechCursor } from '../../src/js/readers/foliate-speech-cursor.js'
import { ReferenceSpeechCursor } from './helpers/reference-foliate-speech-cursor.js'
import { mapSpeechText } from '../../src/js/readers/speech-map.js'

// The Rust cursor is compared with the frozen JavaScript original on identical
// scripted sessions: every observable effect (relocations, navigations,
// overlay paints, flags, results and failures) must be the same, in order.
const parse = text => new DOMParser().parseFromString(`<html><head></head><body>${text}</body></html>`, 'text/html')
const settle = () => new Promise(resolve => setTimeout(resolve, 0))
const MARKUP = [
  '<p>Chapter one. Second sentence here.</p>', '<p>Chapter two. Another sentence.</p><p>More text.</p>',
  '<img src="cover.jpg">', '<p>Chapter four, with   spaces. And more!</p>', '<p>The end.</p>'
]
const cursors = []
afterEach(() => { for (const cursor of cursors.splice(0)) cursor.close(); vi.restoreAllMocks() })

function world(Cursor, flavour) {
  const log = [], env = new EventTarget(); env.hidden = true
  const docs = MARKUP.map(parse), live = parse(MARKUP[0])
  const sections = docs.map((doc, index) => ({ size:100, createDocument:async () => {
    log.push(['createDocument', index])
    if (flavour.failing === index) throw new Error('Unreadable chapter')
    return doc
  } }))
  if (flavour.nonLinear != null) sections[flavour.nonLinear].linear = 'no'
  const overlayer = { add:(name, range, draw, options) => log.push(['overlay.add', name, range.toString(), draw === Overlayer.highlight, options]), remove:name => log.push(['overlay.remove', name]) }
  const view = { book:{ sections, ...(flavour.fixed ? { rendition:{ layout:'pre-paginated' } } : {}) }, lastLocation:{ section:{ current:0 } },
    renderer:{ getContents:() => [{ index:0, doc:live, overlayer }] },
    goTo:async cfi => { log.push(['goTo', cfi]) },
    getCFI:(index, range) => CFI.joinIndir(CFI.fake.fromIndex(index), CFI.fromRange(range)),
    resolveCFI:cfi => { const parts = CFI.parse(cfi); (parts.parent ?? parts).shift(); return { anchor:doc => CFI.toRange(doc, parts) } } }
  const onRelocate = value => log.push(['relocate', value])
  const cursor = new Cursor(view, { env, onRelocate, theme:() => flavour.theme })
  cursors.push(cursor)
  const events = []
  const listener = () => events.push('layout')
  window.addEventListener('inhouse-speech-layout', listener)
  return { cursor, env, view, live, log, events, docs, off:() => window.removeEventListener('inhouse-speech-layout', listener) }
}

function summary(cursor) {
  const current = cursor.current
  return { active:cursor.active, detached:cursor.detached, browsing:cursor.browsing, closed:cursor.closed, epoch:cursor.epoch,
    revealing:Boolean(cursor.revealing), valid:cursor.valid(),
    current:current ? { index:current.index, cfi:current.cfi, offset:current.offset, sentence:current.sentence, detached:current.detached, measured:current.measured ?? null } : null }
}

async function run(Cursor, seed, flavour) {
  let state = seed
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296 }
  const w = world(Cursor, flavour), trace = [], sources = [], calls = []
  const track = (name, value) => { calls.push([name, value]) }
  const wrapLive = () => {
    const map = mapSpeechText(w.live.body)
    const source = w.cursor.wrap({ text:map.text, start:Math.floor(random() * 3), highlight:(a, b) => track('highlight', [a, b]),
      follow:(a, b) => track('follow', [a, b]), clear:() => track('clear', null) }, map, 0)
    sources.push({ source, text:map.text }); return { text:map.text }
  }
  const operations = [
    () => wrapLive(),
    async () => {
      const active = random() > .25
      try {
        const source = await w.cursor.next({ isActive:() => active })
        if (source) sources.push({ source, text:source.text })
        return source === undefined ? 'undefined' : source === null ? 'null' : { text:source.text, start:source.start }
      } catch (error) { return { threw:error.name, message:error.message } }
    },
    () => {
      const entry = sources.at(-1); if (!entry) return 'none'
      const out = entry.source.activate?.(); return { activated:out, valid:entry.source.isValid?.() }
    },
    () => {
      const entry = sources[Math.floor(random() * sources.length)]; if (!entry) return 'none'
      const length = entry.text.length, a = Math.floor(random() * (length + 2)), b = a + Math.floor(random() * 12)
      return { follow:entry.source.follow(a, b) === undefined, a, b }
    },
    () => {
      const entry = sources[Math.floor(random() * sources.length)]; if (!entry) return 'none'
      const length = entry.text.length, a = Math.floor(random() * (length + 1)), b = a + Math.floor(random() * 9)
      entry.source.highlight(a, b); return { a, b }
    },
    () => { sources[Math.floor(random() * sources.length)]?.source.clear?.(); return 'cleared' },
    () => { w.env.hidden = !w.env.hidden; if (!w.env.hidden) w.env.dispatchEvent(new Event('visibilitychange')); return w.env.hidden },
    () => { w.cursor.browse(); return 'browse' },
    async () => { await w.cursor.returnToSpeech(); return 'returned' },
    () => { w.cursor.reset(); return 'reset' },
    async () => { await w.cursor.reveal(); return 'revealed' },
    () => { const source = w.cursor.currentSource(); return source ? { text:source.text, start:source.start } : null },
    () => { const entry = sources.at(-1); entry?.source.adopt?.(); return 'adopt' },
    () => { w.view.lastLocation = { section:{ current:Math.floor(random() * 4) } }; return w.view.lastLocation.section.current }
  ]
  // Weighted toward the operations that move the cursor: preparing, activating and following.
  const weights = [2, 5, 4, 6, 2, 1, 2, 1, 1, 1, 2, 1, 1, 2]
  const deck = weights.flatMap((count, index) => Array(count).fill(index))
  for (let step = 0; step < 22; step++) {
    const index = deck[Math.floor(random() * deck.length)]
    let result
    try { result = await operations[index]() } catch (error) { result = { threw:error.name, message:error.message } }
    await settle()
    trace.push({ index, result, summary:summary(w.cursor), log:JSON.parse(JSON.stringify(w.log)), events:[...w.events], calls:JSON.parse(JSON.stringify(calls)) })
  }
  w.cursor.close()
  w.env.hidden = false; w.env.dispatchEvent(new Event('visibilitychange')); await settle()
  trace.push({ closed:summary(w.cursor), log:JSON.parse(JSON.stringify(w.log)) })
  w.off()
  return trace
}

it('behaves exactly like the original on three hundred scripted sessions', async () => {
  const flavours = [{ theme:'light' }, { theme:'night' }, { theme:'sepia', nonLinear:1 }, { theme:'amoled', fixed:true }, { theme:'sage', failing:3 }]
  const seen = { relocate:0, goTo:0, overlay:0, createDocument:0, aborted:0, failed:0, layout:0, sources:0 }
  for (let seed = 1; seed <= 300; seed++) {
    const flavour = flavours[seed % flavours.length]
    const expected = await run(ReferenceSpeechCursor, 7000 + seed, flavour)
    const actual = await run(FoliateSpeechCursor, 7000 + seed, flavour)
    expect(actual).toEqual(expected)
    const log = expected.at(-1).log
    seen.relocate += log.filter(([name]) => name === 'relocate').length
    seen.goTo += log.filter(([name]) => name === 'goTo').length
    seen.overlay += log.filter(([name]) => name === 'overlay.add').length
    seen.createDocument += log.filter(([name]) => name === 'createDocument').length
    seen.layout += expected.at(-2).events.length
    for (const step of expected) {
      if (step.result?.threw === 'AbortError') seen.aborted++
      if (step.result?.message === 'Unreadable chapter') seen.failed++
      if (step.result?.text) seen.sources++
    }
  }
  // The corpus must really exercise every path it claims to compare.
  expect(seen.relocate).toBeGreaterThan(300)
  expect(seen.goTo).toBeGreaterThan(100)
  expect(seen.overlay).toBeGreaterThan(20)
  expect(seen.createDocument).toBeGreaterThan(300)
  expect(seen.aborted + seen.failed).toBeGreaterThan(10)
  expect(seen.sources).toBeGreaterThan(300)
}, 120000)

it('releases its visibility listener and every handle exactly like the original', async () => {
  for (const Cursor of [ReferenceSpeechCursor, FoliateSpeechCursor]) {
    const w = world(Cursor, { theme:'light' }), removed = vi.spyOn(w.env, 'removeEventListener')
    const source = await w.cursor.next()
    expect(source.activate()).toBe(true)
    w.cursor.close()
    expect(removed).toHaveBeenCalledWith('visibilitychange', w.cursor.onVisibility)
    expect(w.cursor.closed).toBe(true)
    expect(source.isValid()).toBe(false)
    w.off()
  }
})
