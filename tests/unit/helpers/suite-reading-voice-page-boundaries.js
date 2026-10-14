import { beforeAll, afterAll, afterEach, it, expect, vi } from 'vitest'
import { ReadingVoice } from '../../../src/js/readers/reading-voice.js'
import { loadNeural } from '../../../src/js/readers/neural-runtime.js'
import { neuralVoices, setNeuralEngine } from '../../../src/js/readers/neural-voice/index.js'
import { createFakeNeuralEngine, FAKE_CATALOG } from '../../helpers/fake-neural-engine.js'

let saved
beforeAll(async () => { await loadNeural(); saved = [...neuralVoices]; neuralVoices.splice(0, neuralVoices.length, ...FAKE_CATALOG) })
afterAll(() => { neuralVoices.splice(0, neuralVoices.length, ...saved); setNeuralEngine(null) })
afterEach(() => { setNeuralEngine(null); vi.unstubAllGlobals(); localStorage.clear() })

it('joins a physical PDF continuation once and rebuilds its cancelled activation after Pause',async()=>{
  const engine=createFakeNeuralEngine({voices:FAKE_CATALOG,installed:['piper:es_ES-davefx-medium'],hold:true})
  setNeuralEngine(engine)
  const parts=['Empieza en esta página y','continúa en la siguiente. Después termina.'],sources=[]
  const base={text:parts[0],start:0,physicalPage:1,follow:vi.fn(),highlight:vi.fn(),clear:vi.fn()}
  const next=vi.fn(async({isActive,afterPage})=>{
    expect(afterPage).toBe(1)
    const source={text:parts[1],start:0,physicalPage:2,isValid:isActive,activate:vi.fn(isActive),follow:vi.fn(),highlight:vi.fn(),clear:vi.fn()}
    sources.push(source);return source
  })
  const voice=new ReadingVoice({language:'es',getSpeechSource:async()=>base,getNextSpeechSource:next})
  const drain=async()=>{for(let i=0;i<30;i++)await Promise.resolve()}
  const emit=(type,id,offset)=>window.dispatchEvent(new CustomEvent('inhouse-tts',{detail:{type,id,offset}}))
  await voice.play();await drain()
  expect(engine.calls[0].text).toBe('Empieza en esta página y continúa en la siguiente.')
  expect(engine.calls[0].upcoming).toEqual(['Después termina.'])
  emit('start',engine.calls[0].id);emit('boundary',engine.calls[0].id,engine.calls[0].marks[0])
  expect(sources[0].activate).toHaveBeenCalledOnce()
  voice.pause();expect(sources[0].isValid()).toBe(false)
  await voice.play();await drain()
  expect(next).toHaveBeenCalledTimes(2)
  expect(engine.calls[1].text).toBe(engine.calls[0].text)
  expect(engine.calls[1].upcoming).toEqual(['Después termina.'])
  emit('start',engine.calls[1].id);emit('boundary',engine.calls[1].id,engine.calls[1].marks[0])
  expect(sources[1].activate).toHaveBeenCalledOnce();expect(voice.state).toBe('playing')
  voice.stop()
})

it('turns at the audible start of the part on the next page, never during its preparation', async () => {
  const engine = createFakeNeuralEngine({voices:FAKE_CATALOG, installed:['piper:es_ES-davefx-medium'], hold:true})
  setNeuralEngine(engine)
  const text = 'Empieza en esta página y continúa en la siguiente.'
  const cut = text.indexOf('continúa'), highlight = vi.fn(), follow = vi.fn()
  const voice = new ReadingVoice({language:'es', getSpeechSource:async () => ({text, start:0, pageBreaks:[cut], highlight, follow, clear:vi.fn()})})
  const emit = (type, id, offset) => window.dispatchEvent(new CustomEvent('inhouse-tts', {detail:{type, id, offset}}))
  await voice.play()
  const first = engine.calls[0]
  expect(first.text).toBe(text)
  expect(first.upcoming).toEqual([])
  expect(first.marks).toEqual([cut])
  expect(follow).not.toHaveBeenCalled()
  emit('start', first.id)
  expect(follow).toHaveBeenLastCalledWith(0, cut)
  expect(highlight).toHaveBeenCalledTimes(1)
  emit('boundary', first.id, cut)
  expect(engine.calls).toHaveLength(1)
  expect(follow).toHaveBeenLastCalledWith(cut, text.length)
  expect(highlight).toHaveBeenCalledTimes(1)
  expect(highlight).toHaveBeenCalledWith(0, text.length)
  voice.pause()
  emit('boundary', first.id, cut)
  expect(follow).toHaveBeenCalledTimes(2)
  engine.prime=vi.fn(()=>true)
  expect(await voice.preparePlayback()).toBe(true)
  expect(engine.prime).toHaveBeenCalledWith(expect.objectContaining({text,marks:[cut]}))
  voice.stop()
})
