import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReadingVoice } from '../../src/js/readers/reading-voice.js'
import { loadNeural } from '../../src/js/readers/neural-runtime.js'
import { neuralVoices, setNeuralEngine } from '../../src/js/readers/neural-voice/index.js'
import { createFakeNeuralEngine, FAKE_CATALOG } from '../helpers/fake-neural-engine.js'

const NEURAL = 'piper:es_ES-davefx-medium', SECOND = 'piper:es_MX-claude-high'
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

function deviceObserver(kind) {
  const speak=vi.fn(), stop=vi.fn()
  const available={ voiceURI:'sistema-es', name:'Sistema', lang:'es-ES', localService:true }
  if(kind==='native') {
    vi.stubGlobal('speechSynthesis',undefined)
    vi.stubGlobal('InhouseSpeech',{ speak,stop,getVoices:()=>JSON.stringify([available]) })
  } else {
    vi.stubGlobal('InhouseSpeech',undefined)
    vi.stubGlobal('SpeechSynthesisUtterance',class { constructor(text) { this.text=text } })
    vi.stubGlobal('speechSynthesis',{ speak,cancel:stop,getVoices:()=>[available] })
  }
  return { speak,stop }
}
function late(engine,id) { for(const type of ['start','done','interrupted','error']) engine.emit(type,id,'synth-failed') }

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
  const engine = createFakeNeuralEngine({ voices:FAKE_CATALOG, installed:[NEURAL,SECOND], hold:true, ...options })
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

describe.each(['web','native'])('natural voice switches with an available %s device voice',kind=>{
  it('cancels each old voice, preserves the fragment and ignores late events through both switches',async()=>{
    const device=deviceObserver(kind), { reader,highlighted,follow }=mappedReader()
    const { voice,engine }=await reading(reader)
    const first=engine.calls[0]
    engine.emit('start',first.id)
    expect(highlighted).toEqual(['Primera frase.'])
    choose(voice,SECOND)
    const second=engine.calls.at(-1)
    expect(second).toMatchObject({ voiceId:SECOND,text:first.text })
    expect(second.id).not.toBe(first.id)
    expect(engine.stops).toBe(1)
    const follows=follow.mock.calls.length
    late(engine,first.id)
    expect(voice.state).toBe('playing'); expect(voice.utteranceId).toBe(second.id); expect(voice.index).toBe(0)
    expect(follow).toHaveBeenCalledTimes(follows)
    engine.emit('start',second.id); engine.emit('done',second.id)
    const next=engine.calls.at(-1)
    expect(next).toMatchObject({ voiceId:SECOND,text:'Segunda frase.' })
    choose(voice,NEURAL)
    const resumed=engine.calls.at(-1)
    expect(resumed).toMatchObject({ voiceId:NEURAL,text:'Segunda frase.',upcoming:['Tercera frase.'] })
    expect(resumed.id).not.toBe(next.id)
    const beforeLate=follow.mock.calls.length
    late(engine,first.id); late(engine,second.id); late(engine,next.id)
    expect(voice.utteranceId).toBe(resumed.id); expect(voice.index).toBe(1)
    expect(engine.calls).toHaveLength(4); expect(reader.next).not.toHaveBeenCalled()
    expect(follow).toHaveBeenCalledTimes(beforeLate)
    engine.emit('start',resumed.id)
    expect(highlighted.at(-1)).toBe('Segunda frase.')
    engine.emit('done',resumed.id)
    expect(engine.calls.at(-1).text).toBe('Tercera frase.')
    expect(voice.transport).toBe('neural')
    expect(device.speak).not.toHaveBeenCalled(); expect(device.stop).not.toHaveBeenCalled()
  })
  it('switches before the first start and cancels the delayed old start without inventing a highlight',async()=>{
    const device=deviceObserver(kind), { reader,highlighted }=mappedReader()
    const { voice,engine,states }=await reading(reader,{ hold:false,startDelay:5000 })
    const first=engine.calls[0], emitted=vi.spyOn(engine,'emit')
    await vi.advanceTimersByTimeAsync(1000)
    expect(voice.waiting).toBe(true); expect(highlighted).toEqual([])
    engine.config.hold=true
    choose(voice,SECOND)
    const second=engine.calls.at(-1)
    expect(voice.waiting).toBe(false); expect(states.at(-1).message).toBe('')
    await vi.advanceTimersByTimeAsync(10_000)
    expect(emitted).not.toHaveBeenCalled(); expect(highlighted).toEqual([])
    expect(second).toMatchObject({ voiceId:SECOND,text:first.text })
    engine.emit('start',second.id)
    expect(highlighted).toEqual(['Primera frase.'])
    choose(voice,NEURAL)
    const resumed=engine.calls.at(-1)
    late(engine,first.id); late(engine,second.id)
    expect(voice.index).toBe(0); expect(voice.utteranceId).toBe(resumed.id); expect(engine.calls).toHaveLength(3)
    engine.emit('start',resumed.id)
    expect(voice.startedId).toBe(resumed.id); expect(voice.state).toBe('playing')
    expect(device.speak).not.toHaveBeenCalled()
  })
  it('uses the latest natural choice after an awaited page turn, then switches back on that page',async()=>{
    const device=deviceObserver(kind)
    let page=0, finishTurn
    const pages=['Fin de la primera página.','Comienzo de la segunda página. Otra frase.']
    const { reader,highlighted }=mappedReader(()=>pages[page])
    reader.next=vi.fn(()=>new Promise(resolve=>{ finishTurn=()=>{ page=1; reader.location={ fraction:.5 }; resolve() } }))
    const { voice,engine }=await reading(reader)
    const first=engine.calls[0], advance=vi.spyOn(voice,'advance')
    engine.emit('start',first.id); engine.emit('done',first.id)
    const turning=advance.mock.results[0].value
    expect(reader.next).toHaveBeenCalledOnce(); expect(voice.index).toBe(voice.chunks.length)
    choose(voice,SECOND)
    expect(engine.calls).toHaveLength(1)
    finishTurn(); await turning
    const second=engine.calls.at(-1)
    expect(second).toMatchObject({ voiceId:SECOND,text:'Comienzo de la segunda página.' })
    engine.emit('start',second.id)
    expect(highlighted.at(-1)).toBe('Comienzo de la segunda página.')
    choose(voice,NEURAL)
    const resumed=engine.calls.at(-1)
    expect(resumed).toMatchObject({ voiceId:NEURAL,text:second.text,upcoming:['Otra frase.'] })
    late(engine,first.id); late(engine,second.id)
    expect(voice.utteranceId).toBe(resumed.id); expect(voice.state).toBe('playing'); expect(voice.index).toBe(0)
    expect(engine.calls).toHaveLength(3); expect(reader.next).toHaveBeenCalledOnce()
    expect(engine.calls.every(call=>typeof call.text==='string'&&call.text.length>0)).toBe(true)
    expect(device.speak).not.toHaveBeenCalled()
  })
})
