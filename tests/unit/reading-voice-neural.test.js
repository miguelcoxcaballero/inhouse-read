import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest'
import { ReadingVoice } from '../../src/js/readers/reading-voice.js'
import { loadNeural } from '../../src/js/readers/neural-runtime.js'
import { neuralVoices, setNeuralEngine } from '../../src/js/readers/neural-voice/index.js'
import { createFakeNeuralEngine, FAKE_CATALOG } from '../helpers/fake-neural-engine.js'

// The reading voice driving the neural engine through the contract (a fake engine, see tests/helpers).
const DAVEFX = 'piper:es_ES-davefx-medium', LESSAC = 'piper:en_US-lessac-high'
let saved
beforeAll(async () => { await loadNeural(); saved = [...neuralVoices]; neuralVoices.splice(0, neuralVoices.length, ...FAKE_CATALOG) })
afterAll(() => { neuralVoices.splice(0, neuralVoices.length, ...saved); setNeuralEngine(null) })
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); localStorage.clear() }) // a 'too-slow' verdict is remembered across sessions: not across tests

const engineWith = (options = {}) => { const engine = createFakeNeuralEngine({ voices:FAKE_CATALOG, installed:[DAVEFX], hold:true, ...options }); setNeuralEngine(engine); return engine }
const device = (voices = [{ voiceURI:'es-good', name:'es voice', lang:'es-ES', quality:400, network:false, installed:true }, { voiceURI:'en-good', name:'en voice', lang:'en-US', quality:400, network:false, installed:true }]) => {
  const speak = vi.fn(); vi.stubGlobal('InhouseSpeech', { speak, stop:vi.fn(), getVoices:() => JSON.stringify(voices) }); return speak
}
const SENTENCES = 'Primera frase. Segunda frase. Tercera frase. Cuarta frase. Quinta frase. Sexta frase.'
const tts = (type, id, reason) => window.dispatchEvent(new CustomEvent('inhouse-tts', { detail:{ type, id, ...(reason ? { reason } : {}) } }))
const last = engine => engine.calls.at(-1)
function mappedReader(text, extra = {}) {
  const calls = []
  return { calls, language:'es', location:{ fraction:0 }, getSpeechSource:async () => ({ text, start:0,
    highlight:(start, end) => calls.push(['highlight', text.slice(start, end)]), follow:() => calls.push(['follow']), clear:() => calls.push(['clear']) }),
    getSpeechText:async () => { throw new Error('mapped path only') }, next:vi.fn(async () => {}), ...extra }
}
async function reading(text = SENTENCES, { reader = { language:'es', getSpeechText:async () => text }, onState, ...settings } = {}) {
  const voice = new ReadingVoice(reader, onState)
  Object.assign(voice, settings)
  await voice.play()
  return voice
}

describe('neural transport', () => {
  it('speaks the fragment with the neural engine: voice, speed, id and the next fragments as upcoming', async () => {
    const speak = device(), engine = engineWith()
    const voice = await reading(SENTENCES, { rate:1.3 })
    expect(speak).not.toHaveBeenCalled()
    expect(engine.calls).toHaveLength(1)
    expect(last(engine)).toMatchObject({ text:'Primera frase.', voiceId:DAVEFX, rate:1.3, id:voice.utteranceId, upcoming:['Segunda frase.', 'Tercera frase.', 'Cuarta frase.', 'Quinta frase.'] })
    voice.stop()
  })
  it('an installed neural voice is the default; an explicit system voice still wins; an uninstalled neural id is never used', async () => {
    const speak = device(), engine = engineWith()
    let voice = await reading('Hola mundo.'); voice.stop()
    expect(engine.calls).toHaveLength(1)
    voice = await reading('Hola mundo.', { voice:'es-good' }); voice.stop()
    expect(engine.calls).toHaveLength(1) // not asked again
    expect(speak.mock.calls[0].slice(1, 4)).toEqual(['es-ES', 1, 'es-good'])
    voice = await reading('Hola mundo.', { voice:'piper:es_MX-claude-high' }); voice.stop() // chosen once, deleted since: the best available voice
    expect(speak).toHaveBeenCalledTimes(1)
    expect(engine.calls).toHaveLength(2)
    expect(last(engine).voiceId).toBe(DAVEFX)
  })
  it('works with no system speech at all once a neural voice is installed', async () => {
    vi.stubGlobal('speechSynthesis', undefined)
    const engine = engineWith()
    const voice = await reading('Hola mundo.')
    expect(voice.state).toBe('playing')
    expect(engine.calls).toHaveLength(1)
    voice.stop()
  })
  it('unlocks audio synchronously inside the tap, before any await, also when resuming', async () => {
    device()
    const engine = engineWith()
    const voice = new ReadingVoice({ language:'es', getSpeechText:async () => SENTENCES })
    const playing = voice.play() // no await yet: the unlock must already have happened
    expect(engine.unlocks).toBe(1)
    await playing
    voice.pause()
    const resuming = voice.play()
    expect(engine.unlocks).toBe(2)
    await resuming
    voice.stop()
  })
  it('does not unlock audio when no neural voice is installed (nothing to play)', async () => {
    device()
    const engine = engineWith({ installed:[] })
    const voice = await reading('Hola mundo.'); voice.stop()
    expect(engine.unlocks).toBe(0)
    expect(engine.calls).toHaveLength(0)
  })
  it('the highlight is painted at the engine start event, never on a timer', async () => {
    vi.useFakeTimers()
    device(); engineWith()
    const reader = mappedReader(SENTENCES)
    const voice = await reading(SENTENCES, { reader })
    await vi.advanceTimersByTimeAsync(10_000) // far beyond the 1.5 s fallback of the other engines
    expect(reader.calls.filter(c => c[0] === 'highlight')).toEqual([])
    tts('start', voice.utteranceId)
    expect(reader.calls.filter(c => c[0] === 'highlight')).toEqual([['highlight', 'Primera frase.']])
    tts('start', voice.utteranceId); expect(reader.calls.filter(c => c[0] === 'highlight')).toHaveLength(1)
    voice.stop()
  })
  it('done advances to the next fragment with a shorter upcoming list; stale events are ignored', async () => {
    device()
    const engine = engineWith()
    const voice = await reading()
    const first = last(engine).id
    tts('start', first); tts('done', first)
    expect(last(engine)).toMatchObject({ text:'Segunda frase.', upcoming:['Tercera frase.', 'Cuarta frase.', 'Quinta frase.', 'Sexta frase.'] })
    tts('done', first); expect(engine.calls).toHaveLength(2)
    for (let i = 0; i < 3; i++) tts('done', last(engine).id)
    expect(last(engine)).toMatchObject({ text:'Quinta frase.', upcoming:['Sexta frase.'] })
    tts('done', last(engine).id)
    expect(last(engine)).toMatchObject({ text:'Sexta frase.', upcoming:[] })
    voice.stop()
  })
  it('waits honestly: the status says the voice is being prepared, then clears at the start', async () => {
    vi.useFakeTimers()
    device(); engineWith()
    const states = []
    const voice = await reading(SENTENCES, { onState:(state, message) => states.push(message) })
    states.length = 0
    await vi.advanceTimersByTimeAsync(1000)
    expect(states).toEqual(['Preparando la voz natural…'])
    tts('start', voice.utteranceId)
    expect(states.at(-1)).toBe('')
    voice.stop()
  })
  it('pause stops the engine and stays silent; resume speaks the same fragment again; stop frees the engine', async () => {
    device()
    const engine = engineWith()
    const voice = await reading()
    tts('done', last(engine).id)
    const stops = engine.stops
    voice.pause()
    expect(engine.stops).toBe(stops + 1)
    tts('done', last(engine).id) // a late event of the cancelled fragment
    expect(engine.calls).toHaveLength(2)
    await voice.play()
    expect(engine.calls).toHaveLength(3)
    expect(last(engine).text).toBe('Segunda frase.')
    voice.stop()
    expect(engine.stops).toBe(stops + 2)
  })
  it('a speed or voice change re-speaks the current fragment with the new settings', async () => {
    device()
    const engine = engineWith({ installed:[DAVEFX, 'piper:es_MX-claude-high'] })
    const voice = await reading(SENTENCES, { voice:DAVEFX })
    voice.rate = 1.8; voice.restart()
    expect(engine.calls).toHaveLength(2)
    expect(last(engine)).toMatchObject({ text:'Primera frase.', rate:1.8, voiceId:DAVEFX })
    voice.voice = 'piper:es_MX-claude-high'; voice.restart()
    expect(last(engine)).toMatchObject({ voiceId:'piper:es_MX-claude-high' })
    tts('done', engine.calls[0].id)
    expect(engine.calls).toHaveLength(3)
    voice.pause(); voice.restart(); expect(engine.calls).toHaveLength(3)
    voice.stop()
  })
  it("the engine's 'interrupted' pauses the reading like the Android bridge", async () => {
    device()
    const engine = engineWith()
    const voice = await reading()
    tts('interrupted', last(engine).id)
    expect(voice.state).toBe('paused')
  })
  it('turns the page and keeps speaking with the neural voice', async () => {
    device()
    const engine = engineWith()
    let page = 0
    const pages = [{ text:'Fin de página.' }, { text:'Otra página.' }]
    const reader = { language:'es', location:{ fraction:0 }, getSpeechSource:async () => ({ text:pages[page].text, start:0, highlight() {}, follow() {}, clear() {} }),
      next:async () => { if (page < 1) { page++; reader.location = { fraction:.5 } } } }
    const voice = await reading('', { reader })
    tts('start', last(engine).id); tts('done', last(engine).id)
    await vi.waitFor(() => expect(engine.calls).toHaveLength(2))
    expect(last(engine).text).toBe('Otra página.')
    voice.stop()
  })
})

describe('neural voice failures fall back to the best system voice', () => {
  const messages = []
  const watch = (state, message) => message && message !== 'Preparando la voz…' && messages.push(message)
  afterEach(() => { messages.length = 0 })

  it.each([
    ['too-slow', 'La voz natural no va lo bastante rápida en este dispositivo. Sigo con la mejor voz del sistema.'],
    ['init-failed', 'La voz natural no ha podido arrancar. Sigo con la mejor voz del sistema.'],
    ['synth-failed', 'La voz natural no ha podido arrancar. Sigo con la mejor voz del sistema.']
  ])("'%s' hands over to the system voice for the rest of the session, with a visible message", async (reason, message) => {
    const speak = device(), engine = engineWith()
    const voice = await reading(SENTENCES, { onState:watch })
    tts('error', last(engine).id, reason)
    expect(messages).toEqual([message])
    expect(voice.state).toBe('playing')
    expect(engine.stops).toBeGreaterThan(0)
    expect(speak).toHaveBeenCalledTimes(1)
    expect(speak.mock.calls[0].slice(0, 4)).toEqual(['Primera frase.', 'es-ES', 1, 'es-good']) // the same fragment, never a "piper:" id
    expect(voice.neuralOff).toBe(reason)
    // the rest of the session: system voice, the neural engine is not asked again
    tts('done', speak.mock.calls[0][4])
    expect(speak.mock.calls[1][0]).toBe('Segunda frase.')
    expect(engine.calls).toHaveLength(1)
    // pause and resume do not bring it back either, but retryNeural() does
    voice.pause(); await voice.play()
    expect(engine.calls).toHaveLength(1)
    voice.retryNeural(); voice.restart()
    expect(engine.calls).toHaveLength(2)
    voice.stop()
  })
  it('a system voice failing after the hand-over is a real error', async () => {
    const speak = device(), engine = engineWith()
    const voice = await reading(SENTENCES, { onState:watch })
    tts('error', last(engine).id, 'too-slow')
    tts('error', speak.mock.calls[0][4])
    expect(voice.state).toBe('stopped')
    expect(messages.at(-1)).toMatch(/No hay una voz disponible/)
  })
  it("'not-installed' (the saved choice points at a deleted voice) uses the best available voice and asks the engine to re-read its cache", async () => {
    const speak = device(), engine = engineWith({ installed:[DAVEFX, 'piper:es_MX-claude-high'] })
    const voice = await reading(SENTENCES, { onState:watch, voice:'piper:es_MX-claude-high' })
    expect(last(engine).voiceId).toBe('piper:es_MX-claude-high')
    tts('error', last(engine).id, 'not-installed')
    expect(messages).toEqual(['Esa voz natural ya no está instalada. Sigo con la mejor voz disponible.'])
    expect(engine.refreshes).toBeGreaterThan(0)
    expect(last(engine)).toMatchObject({ voiceId:DAVEFX, text:'Primera frase.' }) // another neural voice of the language takes over
    expect(speak).not.toHaveBeenCalled()
    tts('error', last(engine).id, 'not-installed')
    expect(speak.mock.calls[0].slice(0, 4)).toEqual(['Primera frase.', 'es-ES', 1, 'es-good']) // none left: the best system voice
    expect(voice.neuralOff).toBe('') // the voices are fine, only those two are gone
    voice.stop()
  })
  it('an engine that throws on speak() falls back too', async () => {
    const speak = device(), engine = engineWith()
    engine.speak = () => { throw new Error('worker died') }
    const voice = await reading(SENTENCES, { onState:watch })
    await vi.waitFor(() => expect(speak).toHaveBeenCalledTimes(1))
    expect(messages[0]).toMatch(/La voz natural no ha podido arrancar/)
    voice.stop()
  })
  it('an engine that disappears (unsupported) between fragments is replaced by the system voice', async () => {
    const speak = device(), engine = engineWith()
    const voice = await reading()
    engine.config.supported = false
    tts('done', last(engine).id)
    expect(speak.mock.calls[0].slice(0, 4)).toEqual(['Segunda frase.', 'es-ES', 1, 'es-good'])
    voice.stop()
  })
  it('unsupported engines are never used, and the reading is exactly as before', async () => {
    const speak = device(), engine = engineWith({ supported:false })
    const voice = await reading('Hola mundo.')
    expect(engine.unlocks).toBe(0); expect(engine.calls).toHaveLength(0)
    expect(speak.mock.calls[0].slice(1, 4)).toEqual(['es-ES', 1, 'es-good'])
    voice.stop()
  })
})

describe('multilingual reading with neural voices', () => {
  const MIXED = 'Los niños salieron a jugar con una pelota. Salieron todos juntos al parque. The old man was sitting by the window and she was not there. He was not there either.'
  it('uses the installed neural voice of each fragment language and the best system voice otherwise; upcoming stops at a language change', async () => {
    const speak = device(), engine = engineWith()
    const voice = await reading(MIXED, { reader:{ language:'es', getSpeechText:async () => MIXED }, options:{ footnotes:false, multilingual:true, skipHeaders:false }, voice:DAVEFX })
    expect(last(engine)).toMatchObject({ voiceId:DAVEFX, text:expect.stringContaining('Los niños') })
    expect(last(engine).upcoming.length).toBeGreaterThanOrEqual(1)
    expect(last(engine).upcoming.every(text => !/old man/.test(text))).toBe(true)
    tts('done', last(engine).id) // second Spanish sentence
    expect(last(engine).voiceId).toBe(DAVEFX)
    tts('done', last(engine).id) // English: no English neural voice is installed: the system voice
    expect(speak).toHaveBeenCalledTimes(1)
    expect(speak.mock.calls[0].slice(1, 4)).toEqual(['en-US', 1, 'en-good'])
    voice.stop()
    // with an English neural voice installed it takes the English fragment
    const english = engineWith({ installed:[DAVEFX, LESSAC] })
    const again = await reading(MIXED, { reader:{ language:'es', getSpeechText:async () => MIXED }, options:{ footnotes:false, multilingual:true, skipHeaders:false } })
    tts('done', last(english).id); tts('done', last(english).id)
    expect(last(english)).toMatchObject({ voiceId:LESSAC, text:expect.stringContaining('old man') })
    again.stop()
  })
})

describe('review fixes', () => {
  const MIXED = 'Los niños salieron a jugar con una pelota. Salieron todos juntos al parque. The old man was sitting by the window and she was not there. He was not there either.'

  it('a neural voice removed while it reads (also the automatic pick) hands the fragment over at once, instead of leaving the reading silent', async () => {
    const speak = device(), engine = engineWith()
    const voice = await reading(SENTENCES)
    expect(voice.spokenWith.id).toBe(DAVEFX)
    voice.voiceRemoved(DAVEFX)
    expect(engine.stops).toBeGreaterThan(0)
    expect(speak).toHaveBeenCalledTimes(1)
    expect(speak.mock.calls[0].slice(0, 4)).toEqual(['Primera frase.', 'es-ES', 1, 'es-good'])
    expect(voice.state).toBe('playing')
    voice.stop()
  })
  it('a voice removed that is not the one being read changes nothing now, but is not used afterwards', async () => {
    const speak = device(), engine = engineWith({ installed:[DAVEFX, 'piper:es_MX-claude-high'] })
    const voice = await reading(SENTENCES)
    expect(voice.spokenWith.id).not.toBe(DAVEFX) // the high-quality voice wins the automatic pick
    const calls = engine.calls.length
    voice.voiceRemoved(DAVEFX)
    expect(engine.calls).toHaveLength(calls)
    expect(speak).not.toHaveBeenCalled()
    voice.stop()
  })
  it("'Preparando la voz natural…' does not outlive a speed change when the new utterance starts quickly", async () => {
    vi.useFakeTimers()
    device(); engineWith()
    const states = []
    const voice = await reading(SENTENCES, { onState:(state, message) => states.push(message) })
    await vi.advanceTimersByTimeAsync(1000)
    expect(states.at(-1)).toBe('Preparando la voz natural…')
    voice.rate = 1.2; voice.restart()
    expect(states.at(-1)).toBe('') // cleared with the old utterance
    await vi.advanceTimersByTimeAsync(100)
    tts('start', voice.utteranceId)
    expect(states.at(-1)).toBe('')
    voice.stop()
  })
  it('turning Voz multilingüe on while the neural voice reads ahead silences the engine before the system voice takes a foreign fragment', async () => {
    const speak = device(), engine = engineWith()
    const voice = await reading(MIXED, { reader:{ language:'es', getSpeechText:async () => MIXED } })
    expect(voice.transport).toBe('neural')
    voice.options = { footnotes:false, multilingual:true, skipHeaders:false } // what setPreference does for an audio option: no restart
    tts('done', last(engine).id) // second Spanish fragment: still the neural voice
    expect(speak).not.toHaveBeenCalled()
    const stops = engine.stops
    tts('done', last(engine).id) // the English one: the system voice
    expect(speak).toHaveBeenCalledTimes(1)
    expect(speak.mock.calls[0].slice(1, 4)).toEqual(['en-US', 1, 'en-good'])
    expect(engine.stops).toBeGreaterThan(stops)
    expect(voice.transport).toBe('native')
    voice.stop()
  })

  describe('a device that cannot keep up is remembered', () => {
    const giveUp = async () => {
      const engine = engineWith()
      const voice = await reading(SENTENCES, { rate:1.2 })
      tts('error', last(engine).id, 'too-slow')
      voice.stop()
      return engine
    }
    it('the next session starts with the system voice, with the warning, without waking the engine', async () => {
      const speak = device()
      await giveUp()
      const engine = engineWith()
      const voice = await reading(SENTENCES, { rate:1.2 })
      expect(voice.neuralOff).toBe('too-slow')
      expect(engine.calls).toHaveLength(0)
      expect(speak).toHaveBeenCalled()
      voice.stop()
    })
    it('a faster speed is slower still, but a slower one gets another chance', async () => {
      device()
      await giveUp()
      let engine = engineWith()
      let voice = await reading(SENTENCES, { rate:1.8 }); voice.stop()
      expect(engine.calls).toHaveLength(0)
      engine = engineWith()
      voice = await reading(SENTENCES, { rate:1 }); voice.stop()
      expect(engine.calls).toHaveLength(1)
    })
    it('Volver a probar (or a new voice or speed) forgets it for good', async () => {
      device()
      await giveUp()
      let voice = new ReadingVoice({ language:'es', getSpeechText:async () => SENTENCES })
      voice.retryNeural()
      expect(localStorage.getItem('inhouse-read-neural-slow')).toBeNull()
      const engine = engineWith()
      voice = await reading(SENTENCES, { rate:1.2 }); voice.stop()
      expect(engine.calls).toHaveLength(1)
    })
    it('and is forgotten after two weeks', async () => {
      device()
      await giveUp()
      const saved = JSON.parse(localStorage.getItem('inhouse-read-neural-slow'))
      localStorage.setItem('inhouse-read-neural-slow', JSON.stringify({ ...saved, at:saved.at - 15 * 864e5 }))
      const engine = engineWith()
      const voice = await reading(SENTENCES, { rate:1.2 }); voice.stop()
      expect(engine.calls).toHaveLength(1)
    })
  })

  it('a neural voice of another language than the book is not used for it (a Spanish choice must not garble an English book)', async () => {
    const speak = device(), engine = engineWith()
    const voice = await reading('The quick brown fox jumps over the lazy dog.', { reader:{ language:'en-US', metadata:{ language:'en-US' }, getSpeechText:async () => 'The quick brown fox jumps over the lazy dog.' }, voice:DAVEFX })
    expect(engine.calls).toHaveLength(0)
    expect(speak.mock.calls[0].slice(1, 4)).toEqual(['en-US', 1, 'en-good'])
    voice.stop()
    const english = engineWith({ installed:[DAVEFX, LESSAC] })
    const again = await reading('The quick brown fox jumps over the lazy dog.', { reader:{ language:'en-US', metadata:{ language:['en-US'] }, getSpeechText:async () => 'The quick brown fox jumps over the lazy dog.' }, voice:DAVEFX })
    expect(last(english).voiceId).toBe(LESSAC)
    again.stop()
  })
  it('a book that declares no language (a PDF, read on a device in another language) keeps the explicit neural choice', async () => {
    device(); const engine = engineWith()
    const voice = await reading('Hola mundo.', { reader:{ language:'en-US', metadata:{}, getSpeechText:async () => 'Hola mundo.' }, voice:DAVEFX })
    expect(last(engine).voiceId).toBe(DAVEFX)
    voice.stop()
  })
})
