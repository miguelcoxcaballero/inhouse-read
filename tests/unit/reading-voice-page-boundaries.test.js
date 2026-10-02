import { beforeAll, afterAll, afterEach, it, expect, vi } from 'vitest'
import { ReadingVoice } from '../../src/js/readers/reading-voice.js'
import { loadNeural } from '../../src/js/readers/neural-runtime.js'
import { neuralVoices, setNeuralEngine } from '../../src/js/readers/neural-voice/index.js'
import { createFakeNeuralEngine, FAKE_CATALOG } from '../helpers/fake-neural-engine.js'

let saved
beforeAll(async () => { await loadNeural(); saved = [...neuralVoices]; neuralVoices.splice(0, neuralVoices.length, ...FAKE_CATALOG) })
afterAll(() => { neuralVoices.splice(0, neuralVoices.length, ...saved); setNeuralEngine(null) })
afterEach(() => { setNeuralEngine(null); vi.unstubAllGlobals(); localStorage.clear() })

it('turns at the audible start of the part on the next page, never during its preparation', async () => {
  const engine = createFakeNeuralEngine({voices:FAKE_CATALOG, installed:['piper:es_ES-davefx-medium'], hold:true})
  setNeuralEngine(engine)
  const text = 'Empieza en esta página y continúa en la siguiente.'
  const cut = text.indexOf('continúa'), highlight = vi.fn(), follow = vi.fn()
  const voice = new ReadingVoice({language:'es', getSpeechSource:async () => ({text, start:0, pageBreaks:[cut], highlight, follow, clear:vi.fn()})})
  const emit = (type, id) => window.dispatchEvent(new CustomEvent('inhouse-tts', {detail:{type, id}}))
  await voice.play()
  const first = engine.calls[0]
  expect(first.text).toBe('Empieza en esta página y')
  expect(first.upcoming).toEqual(['continúa en la siguiente.'])
  expect(follow).not.toHaveBeenCalled()
  emit('start', first.id)
  expect(follow).toHaveBeenLastCalledWith(0, cut - 1)
  expect(highlight).toHaveBeenCalledTimes(1)
  emit('done', first.id)
  await Promise.resolve()
  const second = engine.calls[1]
  expect(second.text).toBe('continúa en la siguiente.')
  expect(follow).toHaveBeenCalledTimes(1)
  emit('start', second.id)
  expect(follow).toHaveBeenLastCalledWith(cut, text.length)
  expect(highlight).toHaveBeenCalledTimes(1)
  expect(highlight).toHaveBeenCalledWith(0, text.length)
  voice.pause()
  emit('start', second.id)
  expect(follow).toHaveBeenCalledTimes(2)
  voice.stop()
})
