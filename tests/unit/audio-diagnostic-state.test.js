import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('foliate-js/view.js',()=>({}))
vi.mock('foliate-js/overlayer.js',()=>({Overlayer:{}}))
vi.mock('../../src/js/gestures.js',()=>({attachSwipeNavigation:()=>()=>{}}))
import { ReadingVoice } from '../../src/js/readers/reading-voice.js'
import { FoliateReader } from '../../src/js/readers/foliate-reader.js'
import { NeuralEngine } from '../../src/js/readers/neural-voice/engine.js'
import { NeuralVoiceEngine, neuralVoices, setNeuralEngine } from '../../src/js/readers/neural-voice/index.js'
import { loadNeural } from '../../src/js/readers/neural-runtime.js'
import { resetAudio, stopNativeAudio, unlockAudio } from '../../src/js/readers/neural-voice/audio.js'
import { fakeAudioContext, fakeClients, flush } from './neural-fakes.js'
import { FAKE_CATALOG, createFakeNeuralEngine } from '../helpers/fake-neural-engine.js'

let voice, engine, reader, catalogue
beforeAll(async()=>{await loadNeural();catalogue=[...neuralVoices];neuralVoices.splice(0,neuralVoices.length,...FAKE_CATALOG)})
afterAll(()=>neuralVoices.splice(0,neuralVoices.length,...catalogue))
beforeEach(()=>{vi.useFakeTimers();localStorage.clear()})
afterEach(()=>{
  voice?.stop();engine?.stop();reader?.close();voice=null;engine=null;reader=null
  resetAudio();setNeuralEngine(null);vi.clearAllTimers();vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();document.body.innerHTML=''
})
const drain=async()=>{for(let i=0;i<24;i++)await Promise.resolve()}
function playback(extra={}) {
  const bridge={getProtocol:()=>1,begin:vi.fn(),stop:vi.fn(),mark:vi.fn()}
  vi.stubGlobal('InhousePcm',bridge)
  const fake=createFakeNeuralEngine({voices:FAKE_CATALOG,installed:['piper:es_ES-davefx-medium'],hold:true})
  const stop=fake.stop.bind(fake)
  fake.unlock=()=>unlockAudio();fake.stop=()=>{stop();stopNativeAudio()}
  setNeuralEngine(fake)
  const source={language:'es',speechPosition:{kind:'chapter',index:3},
    speechDiagnosticState:{kind:'foliate',index:3,followPending:1,pageTurnPending:0},
    location:{fraction:.1},getSpeechText:async()=> 'Secret book words. Second sentence.',...extra}
  voice=new ReadingVoice(source)
  return {fake,source,bridge}
}
const emit=(type,id=voice.utteranceId)=>window.dispatchEvent(new CustomEvent('inhouse-tts',{detail:{type,id}}))
describe('numeric native callback diagnostics',()=>{
  it('requires the current native session and never exposes book text, CFI, voice or session strings',async()=>{
    const t=playback();expect(window.InhouseReadAudioDiagnostics('old')).toBeNull()
    await voice.play();const session=voice.nativeSession
    expect(window.InhouseReadAudioDiagnostics('old')).toBeNull()
    const state=window.InhouseReadAudioDiagnostics(session)
    expect(state).toMatchObject({schema:1,sessionMatches:true,nativeSessionMatches:true,state:'playing',index:0,chunkCount:2,itemCount:2,
      utterancePresent:true,utteranceStarted:false,ttsStarts:0,ttsDones:0,advanceStage:'idle',reader:{kind:'foliate',index:3,followPending:1,pageTurnPending:0}})
    const text=JSON.stringify(state)
    for(const privateValue of ['Secret book words','Second sentence',session,voice.utteranceId,'piper:es_ES-davefx-medium'])expect(text).not.toContain(privateValue)
    expect(t.fake.calls).toHaveLength(1) // Reading diagnostics does not start additional work.
    voice.stop();expect(window.InhouseReadAudioDiagnostics(session)).toBeNull()
  })
  it('records matched start/done receipts but rejects events from cancelled fragments',async()=>{
    playback();await voice.play();const session=voice.nativeSession,id=voice.utteranceId
    emit('start','stale');emit('done','stale')
    expect(window.InhouseReadAudioDiagnostics(session)).toMatchObject({ttsStarts:0,ttsDones:0})
    emit('start',id);expect(window.InhouseReadAudioDiagnostics(session)).toMatchObject({utteranceStarted:true,ttsStarts:1})
    emit('done',id);expect(window.InhouseReadAudioDiagnostics(session)).toMatchObject({index:1,ttsStarts:1,ttsDones:1,utteranceStarted:false})
    emit('done',id);expect(window.InhouseReadAudioDiagnostics(session).ttsDones).toBe(1)
  })
  it('shows a pending real section turn separately from a synthesis wait, then clears it',async()=>{
    let finish;const gate=new Promise(resolve=>finish=resolve)
    const t=playback({getSpeechText:async()=> 'One sentence.',next:vi.fn(async()=>{await gate;t.source.location={fraction:.2};t.source.getSpeechText=async()=> 'Next chapter.'})})
    await voice.play();const session=voice.nativeSession
    emit('start');emit('done');await drain()
    expect(window.InhouseReadAudioDiagnostics(session)).toMatchObject({state:'playing',index:1,chunkCount:1,ttsDones:1,advanceStage:'next-turn'})
    finish();await drain()
    expect(window.InhouseReadAudioDiagnostics(session)).toMatchObject({advanceStage:'idle',index:0,chunkCount:1})
    expect(t.fake.calls.map(call=>call.text)).toEqual(['One sentence.','Next chapter.'])
  })
  it('does not let a late turn reset the diagnostic state of a stopped session',async()=>{
    let finish;const gate=new Promise(resolve=>finish=resolve)
    playback({getSpeechText:async()=> 'One sentence.',next:()=>gate})
    await voice.play();const session=voice.nativeSession;emit('done');await drain()
    expect(window.InhouseReadAudioDiagnostics(session).advanceStage).toBe('next-turn')
    voice.stop();finish();await drain()
    expect(window.InhouseReadAudioDiagnostics(session)).toBeNull()
    expect(voice.diagnosticAdvance).toBeNull()
  })
  it('reports queued paginator work without changing its promise order or leaking an old book queue',async()=>{
    document.body.innerHTML='<main></main>'
    const view=document.createElement('div');let finish
    Object.assign(view,{open:async()=>{},init:async()=>{},close:()=>{},
      next:vi.fn(()=>new Promise(resolve=>finish=resolve)),prev:vi.fn(async()=>{}),
      renderer:{setStyles:vi.fn(),setAttribute:vi.fn(),removeAttribute:vi.fn()}})
    const create=document.createElement.bind(document)
    vi.spyOn(document,'createElement').mockImplementation(name=>name==='foliate-view'?view:create(name))
    reader=new FoliateReader();await reader.open(document.querySelector('main'),new File(['book'],'book.epub'))
    const first=reader.next(),second=reader.prev();await drain()
    expect(reader.speechDiagnosticState).toEqual({followPending:0,pageTurnPending:2})
    expect(view.next).toHaveBeenCalledOnce();expect(view.prev).not.toHaveBeenCalled()
    reader.close();expect(reader.speechDiagnosticState).toEqual({followPending:0,pageTurnPending:0})
    finish();await Promise.all([first,second]);await drain()
    expect(reader.speechDiagnosticState).toEqual({followPending:0,pageTurnPending:0})
    expect(view.prev).not.toHaveBeenCalled()
  })
})

function core() {
  const ctx=fakeAudioContext(),clients=fakeClients(),env=new EventTarget()
  Object.assign(env,{Worker(){},WebAssembly:{},AudioContext(){},caches:{}})
  engine=new NeuralEngine({createClient:clients.createClient,env,audio:{context:()=>ctx,unlock:()=>ctx},store:{}})
  engine._installed=new Set(['piper:es_ES-davefx-medium'])
  return {ctx,clients,engine}
}
describe('neural engine diagnostics are accurate and read-only',()=>{
  it('does not preload the facade or create a client while reporting an unloaded engine',()=>{
    const facade=new NeuralVoiceEngine()
    expect(facade.getDiagnosticState()).toMatchObject({loaded:false,moduleLoading:false,queuedRequests:0,run:false,workerAlive:false,job:false})
    expect(facade.loading).toBeNull();expect(facade.core).toBeNull()
  })
  it('summarizes actual synthesis state without returning text, cache keys or voice identifiers',async()=>{
    const t=core();t.engine.speak({text:'Secret fragment.',voiceId:'piper:es_ES-davefx-medium',id:'private-id',upcoming:['Next private fragment.']})
    await flush()
    const snapshot=t.engine.getDiagnosticState()
    expect(snapshot).toMatchObject({loaded:true,run:true,job:true,prepared:'ready',workerAlive:true,currentUnit:1,entryCount:2,queued:1,synth:1,started:0,ended:0})
    const serialized=JSON.stringify(snapshot)
    for(const value of ['Secret fragment','Next private fragment','private-id','es_ES-davefx'])expect(serialized).not.toContain(value)
    expect(t.clients.last().jobs).toHaveLength(1)
  })
  it('clears the real hold timer handle when it fires, and clears all run handles on stop',async()=>{
    const t=core();t.engine.speak({text:'Held fragment.',voiceId:'piper:es_ES-davefx-medium',id:'held'})
    await flush();const job=t.clients.last().jobs[0]
    job.handlers.onPlan([1000,1000])
    job.handlers.onChunk({index:0,last:false,pcm:new Float32Array(2205),sampleRate:22050,ms:100})
    expect(t.engine.getDiagnosticState().timers.hold).toBe(true)
    await vi.advanceTimersByTimeAsync(t.engine.limits.maxHoldMs+1)
    expect(t.engine.getDiagnosticState().timers.hold).toBe(false)
    expect(t.ctx.sources).toHaveLength(1)
    const run=t.engine.run;t.engine.stop()
    expect(run.holdTimer).toBeNull();expect(run.feedTimer).toBeNull();expect(run.pumpTimer).toBeNull()
    expect(t.engine.getDiagnosticState()).toMatchObject({run:false,job:false,timers:{hold:false,pump:false,feed:false,idle:true}})
  })
})
