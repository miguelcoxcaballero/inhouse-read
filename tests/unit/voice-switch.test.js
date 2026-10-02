import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReadingVoice } from '../../src/js/readers/reading-voice.js'
import { loadNeural } from '../../src/js/readers/neural-runtime.js'
import { neuralVoices, setNeuralEngine } from '../../src/js/readers/neural-voice/index.js'
import { createFakeNeuralEngine, FAKE_CATALOG } from '../helpers/fake-neural-engine.js'

const NEURAL = 'piper:es_ES-davefx-medium', SYSTEM = 'sistema-es'
const TEXT = 'Primera frase. Segunda frase. Tercera frase.'
const activeVoices = new Set()
let savedCatalog

beforeAll(async () => {
  await loadNeural()
  savedCatalog = [...neuralVoices]
  neuralVoices.splice(0, neuralVoices.length, ...FAKE_CATALOG)
})
beforeEach(() => { vi.useFakeTimers(); localStorage.clear() })
afterEach(() => {
  for (const voice of activeVoices) voice.stop()
  activeVoices.clear()
  setNeuralEngine(null)
  vi.unstubAllGlobals(); vi.useRealTimers(); localStorage.clear()
})
afterAll(() => { neuralVoices.splice(0, neuralVoices.length, ...savedCatalog) })

const tts = (type, id, reason) => window.dispatchEvent(new CustomEvent('inhouse-tts', { detail:{ type, id, ...(reason ? { reason } : {}) } }))

function systemTransport(kind) {
  const calls = [], stop = vi.fn()
  const available = { voiceURI:SYSTEM, name:'Sistema', lang:'es-ES', localService:true, quality:400, network:false, installed:true }
  if (kind === 'native') {
    vi.stubGlobal('speechSynthesis', undefined)
    vi.stubGlobal('InhouseSpeech', {
      getVoices:() => JSON.stringify([available]), stop,
      speak:(text, language, rate, voiceId, id) => calls.push({ text, language, rate, voiceId, id })
    })
  } else {
    vi.stubGlobal('InhouseSpeech', undefined)
    vi.stubGlobal('SpeechSynthesisUtterance', class { constructor(text) { this.text = text } })
    vi.stubGlobal('speechSynthesis', { getVoices:() => [available], cancel:stop, speak:utterance => calls.push(utterance) })
  }
  return {
    calls, stop, available,
    capture:voice => ({ id:voice.utteranceId, call:calls.at(-1) }),
    fire({ id, call }, type) {
      if (kind === 'native') tts(type, id, type === 'error' ? 'synth-failed' : undefined)
      else if (type === 'start') call.onstart?.({})
      else if (type === 'done') call.onend?.({})
      else if (type === 'error') call.onerror?.({ error:'network' })
    }
  }
}

function mappedReader(text = TEXT) {
  const highlighted = [], follow = vi.fn(), clear = vi.fn()
  const reader = {
    language:'es', location:{ fraction:0 }, next:vi.fn(async () => {}),
    getSpeechSource:async () => {
      const speechText = typeof text === 'function' ? text() : text
      return { text:speechText, start:0, highlight:(start, end) => highlighted.push(speechText.slice(start, end)), follow, clear }
    }
  }
  return { reader, highlighted, follow }
}

async function reading(reader, options = {}) {
  const engine = createFakeNeuralEngine({ voices:FAKE_CATALOG, installed:[NEURAL], hold:true, ...options })
  setNeuralEngine(engine)
  const states = [], voice = new ReadingVoice(reader, (state, message) => states.push({ state, message }))
  activeVoices.add(voice)
  voice.voice = NEURAL
  await voice.play()
  return { voice, engine, states }
}

function choose(voice, id) {
  voice.voice = id
  voice.retryNeural()
  voice.restart()
}

describe.each(['web', 'native'])('switching neural and %s system voices', kind => {
  it('cancels each previous transport, preserves the fragment and ignores its late events', async () => {
    const system = systemTransport(kind), { reader, highlighted, follow } = mappedReader()
    const { voice, engine } = await reading(reader)
    const firstNeural = engine.calls[0]
    engine.emit('start', firstNeural.id)
    expect(highlighted).toEqual(['Primera frase.'])

    choose(voice, SYSTEM)
    const firstSystem = system.capture(voice)
    expect(voice.transport).toBe(kind)
    expect(engine.stops).toBe(1)
    expect(engine.current).toBeNull()
    expect(system.calls).toHaveLength(1)
    expect(firstSystem.id).not.toBe(firstNeural.id)
    expect(firstSystem.call.text).toBe('Primera frase.')
    if (kind === 'web') expect(firstSystem.call.voice).toBe(system.available)
    else expect(firstSystem.call.voiceId).toBe(SYSTEM)

    const follows = follow.mock.calls.length
    for (const type of ['start', 'done', 'interrupted', 'error']) engine.emit(type, firstNeural.id, 'synth-failed')
    expect(voice.state).toBe('playing')
    expect(voice.utteranceId).toBe(firstSystem.id)
    expect(voice.index).toBe(0)
    expect(follow).toHaveBeenCalledTimes(follows)
    expect(system.calls).toHaveLength(1)
    expect(engine.calls).toHaveLength(1)

    system.fire(firstSystem, 'start')
    system.fire(firstSystem, 'done')
    const secondSystem = system.capture(voice)
    expect(secondSystem.call.text).toBe('Segunda frase.')
    expect(system.calls).toHaveLength(2)
    expect(engine.calls).toHaveLength(1)

    system.stop.mockImplementationOnce(() => {
      system.fire(secondSystem, 'done')
      system.fire(secondSystem, 'error')
    })
    choose(voice, NEURAL)
    const resumedNeural = engine.calls.at(-1)
    expect(system.stop).toHaveBeenCalledOnce()
    expect(voice.transport).toBe('neural')
    expect(resumedNeural).toMatchObject({ text:'Segunda frase.', voiceId:NEURAL, upcoming:['Tercera frase.'] })
    expect(resumedNeural.id).not.toBe(secondSystem.id)
    const followsBeforeLateEvents = follow.mock.calls.length
    for (const cancelled of [firstSystem, secondSystem]) {
      for (const type of ['start', 'done', 'error']) system.fire(cancelled, type)
      if (kind === 'native') system.fire(cancelled, 'interrupted')
    }
    for (const type of ['start', 'done', 'error']) engine.emit(type, firstNeural.id, 'synth-failed')
    expect(voice.state).toBe('playing')
    expect(voice.utteranceId).toBe(resumedNeural.id)
    expect(voice.index).toBe(1)
    expect(engine.calls).toHaveLength(2)
    expect(reader.next).not.toHaveBeenCalled()
    expect(follow).toHaveBeenCalledTimes(followsBeforeLateEvents)
    expect(highlighted).toEqual(['Primera frase.'])

    engine.emit('start', resumedNeural.id)
    expect(highlighted.at(-1)).toBe('Segunda frase.')
    engine.emit('done', resumedNeural.id)
    expect(engine.calls.at(-1).text).toBe('Tercera frase.')
    expect(engine.calls).toHaveLength(3)
    expect(system.calls).toHaveLength(2)
  })

  it('switches while waiting for the first neural start and cancels its delayed start', async () => {
    const system = systemTransport(kind), { reader, highlighted } = mappedReader()
    const { voice, engine, states } = await reading(reader, { hold:false, startDelay:5000 })
    const first = engine.calls[0], emitted = vi.spyOn(engine, 'emit')
    await vi.advanceTimersByTimeAsync(1000)
    expect(voice.waiting).toBe(true)
    expect(highlighted).toEqual([])

    choose(voice, SYSTEM)
    expect(voice.waiting).toBe(false)
    expect(states.at(-1).message).toBe('')
    const currentSystem = system.capture(voice)
    system.fire(currentSystem, 'start')
    await vi.advanceTimersByTimeAsync(10_000)
    expect(emitted).not.toHaveBeenCalled()
    expect(engine.calls).toHaveLength(1)
    expect(system.calls).toHaveLength(1)
    expect(voice.utteranceId).toBe(currentSystem.id)
    expect(highlighted).toEqual(['Primera frase.'])

    engine.config.hold = true
    choose(voice, NEURAL)
    const resumed = engine.calls.at(-1)
    expect(resumed.text).toBe(first.text)
    engine.emit('start', first.id); engine.emit('done', first.id)
    expect(voice.index).toBe(0)
    expect(voice.utteranceId).toBe(resumed.id)
    expect(engine.calls).toHaveLength(2)
    engine.emit('start', resumed.id)
    expect(voice.startedId).toBe(resumed.id)
    expect(voice.state).toBe('playing')
  })

  it('uses the latest voice when an awaited page turn finishes, then switches back on that page', async () => {
    const system = systemTransport(kind)
    let page = 0, finishTurn
    const pages = ['Fin de la primera página.', 'Comienzo de la segunda página. Otra frase.']
    const { reader, highlighted } = mappedReader(() => pages[page])
    reader.next = vi.fn(() => new Promise(resolve => {
      finishTurn = () => { page = 1; reader.location = { fraction:.5 }; resolve() }
    }))
    const { voice, engine } = await reading(reader)
    const first = engine.calls[0], advance = vi.spyOn(voice, 'advance')
    engine.emit('start', first.id); engine.emit('done', first.id)
    const turning = advance.mock.results[0].value
    expect(reader.next).toHaveBeenCalledOnce()
    expect(voice.index).toBe(voice.chunks.length)

    choose(voice, SYSTEM)
    expect(system.calls).toHaveLength(0)
    finishTurn()
    await turning
    const currentSystem = system.capture(voice)
    expect(currentSystem.call.text).toBe('Comienzo de la segunda página.')
    expect(engine.stops).toBe(1)
    expect(engine.calls).toHaveLength(1)
    expect(voice.transport).toBe(kind)
    system.fire(currentSystem, 'start')
    expect(highlighted.at(-1)).toBe('Comienzo de la segunda página.')

    choose(voice, NEURAL)
    expect(system.stop).toHaveBeenCalledOnce()
    expect(engine.calls.at(-1)).toMatchObject({ text:'Comienzo de la segunda página.', voiceId:NEURAL, upcoming:['Otra frase.'] })
    engine.emit('done', first.id)
    system.fire(currentSystem, 'done')
    expect(voice.state).toBe('playing')
    expect(voice.index).toBe(0)
    expect(engine.calls).toHaveLength(2)
    expect(reader.next).toHaveBeenCalledOnce()
    expect(system.calls.every(call => typeof call.text === 'string' && call.text.length > 0)).toBe(true)
  })
})
