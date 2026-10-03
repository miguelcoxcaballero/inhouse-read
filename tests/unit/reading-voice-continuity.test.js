import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('foliate-js/view.js', () => ({}))
vi.mock('foliate-js/overlayer.js', () => ({ Overlayer:{} }))
vi.mock('../../src/js/gestures.js', () => ({ attachSwipeNavigation:() => () => {} }))
// These tests exercise the section/page-turn queue, not layout measurement.
// The existing page-boundary suite verifies offsets from laid-out glyphs.
vi.mock('../../src/js/readers/speech-page-breaks.js', () => ({ speechPageBreaks:async () => [] }))

import { FoliateReader } from '../../src/js/readers/foliate-reader.js'
import { ReadingVoice } from '../../src/js/readers/reading-voice.js'
import { loadNeural } from '../../src/js/readers/neural-runtime.js'
import { neuralVoices, setNeuralEngine } from '../../src/js/readers/neural-voice/index.js'
import { createFakeNeuralEngine, FAKE_CATALOG } from '../helpers/fake-neural-engine.js'

const VOICE = 'piper:es_ES-davefx-medium'
let savedCatalogue
const sessions = []
beforeAll(async () => {
  await loadNeural()
  savedCatalogue = [...neuralVoices]
  neuralVoices.splice(0, neuralVoices.length, ...FAKE_CATALOG)
})
beforeEach(() => { vi.useFakeTimers(); localStorage.clear() })
afterEach(() => {
  for (const { voice, reader } of sessions.splice(0)) { voice.stop(); reader.close() }
  setNeuralEngine(null); vi.restoreAllMocks(); vi.useRealTimers(); document.body.innerHTML = ''; localStorage.clear()
})
afterAll(() => { neuralVoices.splice(0, neuralVoices.length, ...savedCatalogue) })
const drain = async () => { for (let step = 0; step < 24; step++) await Promise.resolve() }

/** Foliate's real contract: next() is silently ignored while locked, its
 * relocate event precedes release, and a source contains the whole section.
 * The source's map/ranges/follow/queue and ReadingVoice are production code. */
async function reading(chapters = 2, delay = 800) {
  document.body.innerHTML = '<main></main><aside></aside>'
  const host = document.querySelector('aside'), documents = []
  for (let index = 0; index < chapters; index++) {
    const frame = document.createElement('iframe'); host.append(frame)
    const doc = frame.contentDocument
    doc.body.innerHTML = `<p>Inicio del capítulo ${index + 1}.</p><p>Final del capítulo ${index + 1}.</p>`
    Object.defineProperty(doc.defaultView.Range.prototype, 'getClientRects', {
      configurable:true, value:() => [{ left:0, top:0, right:390, bottom:40, width:390, height:40 }]
    })
    documents.push(doc)
  }
  const view = document.createElement('div'), accepted = [], messages = []
  let chapter = 0, page = 0, locked = false, location
  const visible = () => {
    const doc = documents[chapter], node = doc.body.children[page].firstChild
    const range = doc.createRange(); range.selectNodeContents(node)
    view.lastLocation = { range, index:chapter }
    location = { fraction:(chapter * 2 + page) / (chapters * 2), locator:{kind:'cfi',value:`chapter-${chapter}-page-${page}`} }
  }
  Object.assign(view, {
    open:vi.fn(async () => {}), init:vi.fn(async () => {}), close:vi.fn(),
    renderer:{ setStyles:vi.fn(), setAttribute:vi.fn(), removeAttribute:vi.fn(), getContents:() => [{doc:documents[chapter]}], scrollToAnchor:vi.fn(async () => {}) },
    next:vi.fn(async () => {
      if (locked || chapter === chapters - 1 && page === 1) return
      locked = true
      if (page === 0) { page = 1; accepted.push(['page', chapter]) }
      else { chapter++; page = 0; accepted.push(['chapter', chapter]) }
      visible()
      await new Promise(resolve => setTimeout(resolve, delay))
      locked = false
    }),
    prev:vi.fn(async () => {})
  })
  const create = document.createElement.bind(document)
  vi.spyOn(document, 'createElement').mockImplementation(name => name === 'foliate-view' ? view : create(name))
  const reader = new FoliateReader()
  await reader.open(document.querySelector('main'), new File(['book'], 'book.epub'))
  visible()
  const adapter = { language:'es', get location() { return location }, getSpeechSource:() => reader.getSpeechSource(), getSpeechText:() => reader.getSpeechText(), next:options => reader.next(options) }
  const engine = createFakeNeuralEngine({ voices:FAKE_CATALOG, installed:[VOICE], hold:true })
  setNeuralEngine(engine)
  const voice = new ReadingVoice(adapter, (_, message) => { if (message) messages.push(message) })
  voice.voice = VOICE; sessions.push({voice,reader})
  const emit = type => engine.emit(type, engine.calls.at(-1).id)
  const first = async () => {
    await voice.play(); emit('start'); emit('done'); await drain(); emit('start'); await drain()
  }
  return { voice, reader, engine, view, accepted, messages, emit, first, chapter:() => chapter, page:() => page }
}

describe('audiobook section continuity shares the paginator follow queue', () => {
  it('waits for the final audible follow turn instead of claiming book end during its lock', async () => {
    const t = await reading()
    await t.first()
    expect(t.engine.calls.map(call => call.text)).toEqual(['Inicio del capítulo 1.', 'Final del capítulo 1.'])
    expect(t.accepted).toEqual([['page', 0]])
    t.emit('done'); await vi.advanceTimersByTimeAsync(500)
    expect(t.voice.state).toBe('playing')
    expect(t.messages).not.toContain('Final del libro.')
    await vi.advanceTimersByTimeAsync(1200)
    expect(t.accepted).toEqual([['page', 0], ['chapter', 1]])
    expect(t.engine.calls.at(-1).text).toBe('Inicio del capítulo 2.')
    expect(t.voice.state).toBe('playing')
  })

  it('continues through eighteen chapters and more than six minutes without dropping or repeating text', async () => {
    const t = await reading(18)
    await t.voice.play()
    const heard = [], startedAt = Date.now()
    for (let chapter = 1; chapter <= 18; chapter++) {
      expect(t.voice.state).toBe('playing')
      expect(t.engine.calls.at(-1).text).toBe(`Inicio del capítulo ${chapter}.`)
      t.emit('start'); heard.push(t.engine.calls.at(-1).text)
      await vi.advanceTimersByTimeAsync(20_000); t.emit('done'); await drain()
      expect(t.engine.calls.at(-1).text).toBe(`Final del capítulo ${chapter}.`)
      t.emit('start'); heard.push(t.engine.calls.at(-1).text)
      // A short last phrase ends before Foliate's animated follow releases its lock.
      await vi.advanceTimersByTimeAsync(200); t.emit('done')
      await vi.advanceTimersByTimeAsync(1800)
    }
    expect(Date.now() - startedAt).toBeGreaterThan(6 * 60_000)
    expect(heard).toEqual(Array.from({length:18}, (_, index) => [`Inicio del capítulo ${index + 1}.`, `Final del capítulo ${index + 1}.`]).flat())
    expect(t.engine.calls).toHaveLength(36)
    expect(t.accepted.filter(([kind]) => kind === 'chapter')).toHaveLength(17)
    expect(t.voice.state).toBe('stopped')
    expect(t.messages.filter(message => message === 'Final del libro.')).toHaveLength(1)
  })

  it('keeps rapid manual next/prev ordering intact after an audible follow has released the lock', async () => {
    const t = await reading()
    await t.first()
    const next = t.reader.next(), back = t.reader.prev()
    await vi.advanceTimersByTimeAsync(2000); await Promise.all([next, back])
    expect(t.accepted).toEqual([['page', 0], ['chapter', 1]])
    expect(t.view.prev).toHaveBeenCalledOnce()
  })

  it('drops a queued chapter transition if the reader is closed during its audible follow', async () => {
    const t = await reading()
    await t.first()
    const next = t.reader.next()
    t.voice.stop(); t.reader.close()
    await vi.advanceTimersByTimeAsync(2000); await next
    expect(t.accepted).toEqual([['page', 0]])
    expect(t.engine.calls).toHaveLength(2)
    expect(t.messages).not.toContain('Final del libro.')
  })

  it.each(['pause', 'stop'])('cancels a chapter turn still waiting for follow when the voice receives %s', async action => {
    const t = await reading()
    await t.first(); t.emit('done'); await vi.advanceTimersByTimeAsync(100)
    t.voice[action]()
    await vi.advanceTimersByTimeAsync(2000)
    expect(t.accepted).toEqual([['page', 0]])
    expect(t.chapter()).toBe(0)
    expect(t.engine.calls).toHaveLength(2)
    expect(t.messages).not.toContain('Final del libro.')
    expect(t.voice.state).toBe(action === 'pause' ? 'paused' : 'stopped')
  })

  it('a failed cosmetic follow does not poison subsequent manual page navigation', async () => {
    const t = await reading()
    t.view.next.mockRejectedValueOnce(new Error('Detached highlight range'))
    await t.first()
    const next = t.reader.next()
    await vi.advanceTimersByTimeAsync(900)
    await expect(next).resolves.toBeUndefined()
    expect(t.accepted).toEqual([['page', 0]])
    expect(t.voice.state).toBe('playing')
  })
})
