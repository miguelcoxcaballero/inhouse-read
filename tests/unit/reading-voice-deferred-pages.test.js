import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReadingVoice } from '../../src/js/readers/reading-voice.js'
import { loadNeural } from '../../src/js/readers/neural-runtime.js'
import { neuralVoices, setNeuralEngine } from '../../src/js/readers/neural-voice/index.js'
import { createFakeNeuralEngine, FAKE_CATALOG } from '../helpers/fake-neural-engine.js'

const VOICE = 'piper:es_ES-davefx-medium', SECOND = 'piper:es_MX-claude-high'
let savedCatalogue
const voices = new Set()
beforeAll(async () => {
  await loadNeural()
  savedCatalogue = [...neuralVoices]
  neuralVoices.splice(0, neuralVoices.length, ...FAKE_CATALOG)
})
beforeEach(() => { vi.useFakeTimers(); localStorage.clear() })
afterEach(() => {
  for (const voice of voices) voice.stop()
  voices.clear(); setNeuralEngine(null); vi.useRealTimers(); localStorage.clear()
})
afterAll(() => { neuralVoices.splice(0, neuralVoices.length, ...savedCatalogue) })
const drain = async () => { for (let step = 0; step < 20; step++) await Promise.resolve() }

function reading(pages = ['Primera página.', 'Continúa la frase.']) {
  const engine = createFakeNeuralEngine({ voices:FAKE_CATALOG, installed:[VOICE], hold:true })
  setNeuralEngine(engine)
  const calls = [], stages = [], messages = []
  let visible = 0
  const source = (page, isActive) => {
    let activated = !isActive, disposed = false
    const value = {
      text:pages[page], start:0,
      highlight:vi.fn((start, end) => calls.push(['highlight', page, start, end])),
      follow:vi.fn((start, end) => calls.push(['follow', page, start, end])),
      clear:vi.fn(() => { if (!activated) disposed = true; calls.push(['clear', page]) })
    }
    if (isActive) value.activate = vi.fn(() => {
      calls.push(['activate', page])
      if (disposed || (!activated && !isActive())) return false
      if (activated) return visible === page
      activated = true; visible = page; reader.location = { page }; return true
    })
    return value
  }
  const reader = {
    language:'es', location:{ page:0 },
    getSpeechSource:vi.fn(async () => source(visible)),
    getNextSpeechSource:vi.fn(async ({ isActive }) => {
      if (visible + 1 >= pages.length) return null
      const staged = source(visible + 1, isActive); stages.push(staged); return staged
    }),
    next:vi.fn(async () => { if (visible + 1 < pages.length) reader.location = { page:++visible } })
  }
  const voice = new ReadingVoice(reader, (_, message) => { if (message) messages.push(message) })
  voice.voice = VOICE; voices.add(voice)
  const emit = (type, id = engine.calls.at(-1).id) => engine.emit(type, id)
  const first = async () => { await voice.play(); emit('start'); emit('done'); await drain() }
  return { reader, voice, engine, calls, stages, messages, source, emit, first, visible:() => visible }
}

describe('prepared page sources follow only an audible natural fragment', () => {
  it('keeps the previous page while preparing and synthesising, then commits before the first highlight', async () => {
    const t = reading()
    await t.first()
    expect(t.reader.next).not.toHaveBeenCalled()
    expect(t.engine.calls).toHaveLength(2)
    expect(t.engine.calls[1].text).toBe('Continúa la frase.')
    expect(t.visible()).toBe(0)
    expect(t.stages[0].activate).not.toHaveBeenCalled()
    expect(t.calls).not.toContainEqual(['clear', 0])
    t.emit('start')
    expect(t.visible()).toBe(1)
    expect(t.calls.filter(call => call[1] === 1).map(call => call[0])).toEqual(['activate', 'highlight', 'follow'])
  })

  it('disposes a prepared source that resolves after Stop without speaking or navigating', async () => {
    const t = reading()
    let resolve, active
    t.reader.getNextSpeechSource.mockImplementation(({ isActive }) => { active = isActive; return new Promise(done => { resolve = done }) })
    await t.first()
    expect(active()).toBe(true)
    t.voice.stop()
    const staged = t.source(1, active); resolve(staged); await drain()
    expect(active()).toBe(false)
    expect(staged.clear).toHaveBeenCalledTimes(1)
    expect(staged.activate).not.toHaveBeenCalled()
    expect(t.engine.calls).toHaveLength(1)
    expect(t.visible()).toBe(0)
    expect(t.messages).not.toContain('Final del libro.')
  })

  it('reprepares the same continuation after pausing before its first start, without repeating the old page', async () => {
    const t = reading()
    await t.first()
    const cancelledId = t.engine.calls.at(-1).id, discarded = t.stages[0]
    t.voice.pause(); t.emit('start', cancelledId)
    expect(t.visible()).toBe(0)
    expect(discarded.clear).toHaveBeenCalled()
    await t.voice.play()
    expect(t.reader.getNextSpeechSource).toHaveBeenCalledTimes(2)
    expect(t.engine.calls.map(call => call.text)).toEqual(['Primera página.', 'Continúa la frase.', 'Continúa la frase.'])
    expect(t.visible()).toBe(0)
    t.emit('start')
    expect(discarded.activate).not.toHaveBeenCalled()
    expect(t.visible()).toBe(1)
  })

  it('reprepares after pausing during extraction and disposes the late old preparation', async () => {
    const t = reading()
    let resolve, oldActive
    t.reader.getNextSpeechSource.mockImplementationOnce(({ isActive }) => { oldActive = isActive; return new Promise(done => { resolve = done }) })
    await t.first(); t.voice.pause()
    await t.voice.play()
    const old = t.source(1, oldActive); resolve(old); await drain()
    expect(old.clear).toHaveBeenCalledTimes(1)
    expect(old.activate).not.toHaveBeenCalled()
    expect(t.engine.calls.map(call => call.text)).toEqual(['Primera página.', 'Continúa la frase.'])
    expect(t.visible()).toBe(0)
    t.emit('start'); expect(t.visible()).toBe(1)
  })

  it('resumes an already activated page with its existing fragment and mapping', async () => {
    const t = reading()
    await t.first(); t.emit('start'); t.voice.pause(); await t.voice.play(); t.emit('start')
    expect(t.reader.getNextSpeechSource).toHaveBeenCalledTimes(1)
    expect(t.visible()).toBe(1)
    expect(t.engine.calls.at(-1).text).toBe('Continúa la frase.')
    expect(t.stages[0].highlight).toHaveBeenCalledTimes(2)
  })

  it('never activates or advances a staged source from done without an authentic matching start', async () => {
    const t = reading(['Primera página.', 'Continúa. Otra frase.'])
    await t.first(); t.emit('done'); await drain()
    expect(t.stages[0].activate).not.toHaveBeenCalled()
    expect(t.visible()).toBe(0)
    expect(t.voice.state).toBe('paused')
    expect(t.engine.calls).toHaveLength(2)
    expect(t.reader.getNextSpeechSource).toHaveBeenCalledTimes(1)
    expect(t.messages.at(-1)).toContain('Reintentar')
  })

  it('ignores the previous utterance start and starts the new natural selection only at its own start', async () => {
    const t = reading()
    await t.first()
    const old = t.engine.calls[0].id, pending = t.engine.calls[1].id
    t.emit('start', old); expect(t.stages[0].activate).not.toHaveBeenCalled()
    t.engine.set.add(SECOND); t.voice.voice = SECOND; t.voice.rate = 1.25
    t.voice.restart(); t.emit('start', pending)
    expect(t.visible()).toBe(0)
    expect(t.engine.calls.at(-1)).toMatchObject({ voiceId:SECOND, rate:1.25, text:'Continúa la frase.' })
    t.emit('start'); expect(t.visible()).toBe(1)
  })

  it('recognises a true end without a navigation call', async () => {
    const t = reading(['Única página.'])
    await t.first()
    expect(t.voice.state).toBe('stopped')
    expect(t.messages.at(-1)).toBe('Final del libro.')
    expect(t.reader.next).not.toHaveBeenCalled()
    expect(t.visible()).toBe(0)
  })

  it('retains legacy navigation when the optional reader delegation returns undefined', async () => {
    const t = reading()
    t.reader.getNextSpeechSource.mockResolvedValue(undefined)
    await t.first()
    expect(t.reader.next).toHaveBeenCalledTimes(1)
    expect(t.engine.calls.at(-1).text).toBe('Continúa la frase.')
    expect(t.visible()).toBe(1)
  })

  it('reports a preparation error without misreporting the book end or navigating', async () => {
    const t = reading()
    t.reader.getNextSpeechSource.mockRejectedValue(new Error('page render failed'))
    await t.first()
    expect(t.voice.state).toBe('stopped')
    expect(t.messages.at(-1)).toBe('No se pudo pasar de página.')
    expect(t.messages).not.toContain('Final del libro.')
    expect(t.reader.next).not.toHaveBeenCalled()
    expect(t.visible()).toBe(0)
  })

  it('plans the supplied source with the usual text options and exact raw offsets', async () => {
    const t = reading(['Primera página.', 'Ignorada. Continuación [1] nueva.'])
    t.reader.getNextSpeechSource.mockImplementation(async ({ isActive }) => {
      const staged = t.source(1, isActive); staged.start = staged.text.indexOf('Continuación'); t.stages.push(staged); return staged
    })
    await t.first()
    expect(t.engine.calls.at(-1).text).toBe('Continuación nueva.')
    t.emit('start')
    expect(t.stages[0].highlight).toHaveBeenCalledWith(10, 'Ignorada. Continuación [1] nueva.'.length)
  })

  it.each(['false', 'throw', 'undefined'])('pauses on an invalid activation (%s), without highlighting or claiming the end', async failure => {
    const t = reading()
    await t.first()
    t.stages[0].activate.mockImplementation(() => { if (failure === 'throw') throw new Error('stale page'); return failure === 'undefined' ? undefined : false })
    t.emit('start')
    expect(t.voice.state).toBe('paused')
    expect(t.stages[0].highlight).not.toHaveBeenCalled()
    expect(t.stages[0].follow).not.toHaveBeenCalled()
    expect(t.messages.at(-1)).toBe('No se pudo mostrar la página. Pulsa Reintentar para continuar.')
    expect(t.messages).not.toContain('Final del libro.')
    expect(t.visible()).toBe(0)
  })
})
