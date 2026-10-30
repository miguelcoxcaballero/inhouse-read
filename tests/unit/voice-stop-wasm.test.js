import assert from 'node:assert/strict'
import {it,expect,vi,afterEach} from 'vitest'
import {readFileSync} from 'node:fs'
import {LegacyVoiceStop} from './helpers/reference-voice-stop.js'
// The session's methods (reading-voice.js) called on the fixture host, as the former wrapper modules did.
import {ReadingVoice} from '../../src/js/readers/reading-voice.js'
const method=name=>(host,...args)=>ReadingVoice.prototype[name].call(host,...args)
const pauseReadingVoice=method('pause')
import * as ui from '../../src/wasm/ui/inhouse_read_ui.js'
const fixture=vi.hoisted(()=>({deps:{},ui:null}))
vi.mock('../../src/js/readers/neural-runtime.js',()=>({neuralEngine:()=>fixture.deps.engine()}))
vi.mock('../../src/js/readers/neural-voice/audio.js',()=>({nativeAudio:()=>fixture.deps.native()}))
vi.mock('../../src/js/rust-ui.js',()=>({getRustUI:()=>fixture.ui}))
const configure=deps=>{fixture.deps=deps}
const core=ui.initSync({module:readFileSync('src/wasm/ui/inhouse_read_ui_bg.wasm')})
afterEach(()=>{fixture.ui=null;fixture.deps={};vi.restoreAllMocks()})
function setup(native,trial){
 const host=new LegacyVoiceStop(),events=[],original={text:'Original text'}
 Object.assign(host,{state:['playing','loading','paused','stopped'][trial%4],generation:5,chunks:['First','Second'],items:[{text:'First',unjoined:trial%2?original:null},{text:'Second'}],index:trial%3,
  reader:{location:{page:2}},transport:trial%2?'neural':null,presentTimer:11,waitTimer:12,sleepTimer:13,utteranceId:'active',waiting:true,
  deferredPage:trial%5===0?{id:'deferred'}:null,preparingPage:trial%7?{generation:trial%3?5:4}:null,missing:new Set(['missing']),source:{text:'Source'},diagnosticAdvance:{id:'pending'},browsing:true,nativeSession:'session',neuralOff:'failed',neuralRetries:2,spokenWith:{id:'voice'},completeOpening:true,openingPlan:{id:'plan'}})
 const record=(name)=>(...args)=>{events.push([name,...args]);if(trial%17===0)throw Error(name)}
 const engine={cancelCurrent:record('engineCancel'),pause:record('enginePause'),stop:record('engineStop')}
 if(trial%3===0)delete engine.cancelCurrent;if(trial%5===0)delete engine.pause
 host.reader.stopSpeech=trial%7===0?undefined:()=>{events.push(['stopSpeech',host.state,host.generation]);if(trial%19===0)throw Error('stopSpeech')}
 host.clearAhead=()=>events.push(['clearAhead']);host.unpaint=()=>events.push(['unpaint',host.state,host.generation]);host.notify=(...args)=>events.push(['notify',host.state,host.generation,...args]);host.speakCurrent=()=>events.push(['speak'])
 const deps={clear:id=>events.push(['clear',id]),native:()=>{events.push(['native']);return trial%11===0?null:{session:'session'}},engine:()=>{events.push(['engine']);return trial%13===0?null:engine}}
 if(native){
  host.pause=()=>ui.voice_pause(host);host.stop=()=>ui.voice_stop(host,deps.clear);host.restart=()=>ui.voice_restart(host);host.retryNeural=()=>ui.voice_retry(host);host.fail=message=>ui.voice_fail(host,message)
  host.cancelUtterance=(reason='stop')=>ui.voice_cancel(host,reason,deps.clear,deps.native,deps.engine)
 }else {configure(deps);vi.spyOn(globalThis,"clearTimeout").mockImplementation(deps.clear)}
 return {host,events,original}
}
it('preserves all interruption effects and errors through 500 sequences',()=>{
for(let trial=0;trial<500;trial++){
 const results=[]
 for(const native of [false,true]){
  const {host,events,original}=setup(native,trial),errors=[]
  for(const [method,args] of [['restart',[]],['pause',[]],['retryNeural',[]],['stop',[]],['fail',['Failed']],['cancelUtterance',['restart']],['cancelUtterance',['pause']]]){
   try{host[method](...args)}catch(error){errors.push([method,error.message])}
  }
  results.push({events,errors,state:host.state,generation:host.generation,chunks:host.chunks,items:host.items,index:host.index,source:host.source,
   original,missing:[...host.missing],diagnostic:host.diagnosticAdvance,completeOpening:host.completeOpening,openingPlan:host.openingPlan,browsing:host.browsing,nativeSession:host.nativeSession,neuralOff:host.neuralOff,neuralRetries:host.neuralRetries,
   spokenWith:host.spokenWith,pausedLocation:host.pausedLocation,stoppedLocation:host.stoppedLocation,waiting:host.waiting,transport:host.transport,utteranceId:host.utteranceId,resumeNextPage:host.resumeNextPage,preparingPage:host.preparingPage,deferredPage:host.deferredPage})
 }
 assert.deepEqual(results[1],results[0],'scenario '+trial)
}

})
it('releases cancellation handles over 2000 pause and stop cycles',()=>{
for(let round=0;round<2;round++){
 const before=core.memory.buffer.byteLength
 for(let trial=0;trial<1000;trial++){const {host}=setup(true,trial);try{host.pause();host.stop()}catch{}}
 if(round)assert.equal(core.memory.buffer.byteLength,before)
}

})

it('restores the exact unjoined fragment on pause while invalidating its old generation',()=>{
 const {host,original}=setup(true,9);host.deferredPage=null;host.preparingPage=null
 host.pause();expect(host.items[0]).toBe(original);expect(host.chunks[0]).toBe(original.text)
 expect(host.generation).toBe(6);expect(host.state).toBe('paused')
})
it('retains a pending-page resume while dropping its cancelled page and fragment references',()=>{
 const {host}=setup(true,0);host.pause()
 expect(host.resumeNextPage).toBe(true);expect(host.deferredPage).toBeNull();expect(host.source).toBeNull()
 expect(host.chunks).toEqual([]);expect(host.items).toEqual([]);expect(host.index).toBe(0)
})
it('rejects a cyclic location before modifying stop state or cancelling transport',()=>{
 const {host,events}=setup(true,1);host.reader.location.self=host.reader.location
 expect(()=>host.stop()).toThrow();expect(events).toEqual([]);expect(host.generation).toBe(5);expect(host.utteranceId).toBe('active')
})
it('adopts a late pause implementation without replacing the active voice',()=>{
 const {host}=setup(false,1),native={voice_pause:vi.fn(ui.voice_pause)}
 fixture.ui=native;pauseReadingVoice(host);expect(native.voice_pause).toHaveBeenCalledWith(host);expect(host.state).toBe('paused')
})
