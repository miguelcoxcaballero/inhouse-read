import assert from 'node:assert/strict'
import {it,expect,vi,afterEach} from 'vitest'
import {readFileSync} from 'node:fs'
import {LegacyVoiceStart} from './helpers/reference-voice-start.js'
// The session's methods (reading-voice.js) called on the fixture host, as the former wrapper modules did.
import {ReadingVoice} from '../../src/js/readers/reading-voice.js'
const method=name=>(host,...args)=>ReadingVoice.prototype[name].call(host,...args)
const restartVisibleVoice=method('restartFromVisiblePage')
const playReadingVoice=method('play')
import * as ui from '../../src/wasm/ui/inhouse_read_ui.js'
const fixture=vi.hoisted(()=>({deps:{},ui:null}))
vi.mock('../../src/js/readers/neural-runtime.js',()=>({loadNeural:()=>fixture.deps.load(),neuralEngine:()=>fixture.deps.engine(),unlockNeural:()=>fixture.deps.unlock()}))
vi.mock('../../src/js/readers/neural-voice/audio.js',()=>({nativeAudio:()=>fixture.deps.native()}))
vi.mock('../../src/js/rust-ui.js',()=>({getRustUI:()=>fixture.ui}))
const configure=deps=>{fixture.deps=deps}
const core=ui.initSync({module:readFileSync('src/wasm/ui/inhouse_read_ui_bg.wasm')})
afterEach(()=>{fixture.ui=null;fixture.deps={}})
function setup(native,trial){
 const host=new LegacyVoiceStart(),events=[]
 Object.assign(host,{state:['stopped','paused','playing','loading'][trial%4],generation:0,chunks:trial%3?['Old']:[],resumeNextPage:trial%5===0,browsing:trial%7===0,reader:{location:{page:2}},pausedLocation:trial%3?JSON.stringify({page:2}):JSON.stringify({page:1}),stoppedLocation:undefined})
 const plan={source:{text:trial%2?'Some text':''},items:trial%7?['New']:[]}
 const reject=(name)=>{throw Error(name)}
 host.retryNeural=()=>{events.push(['retry']);if(trial%41===0)reject('retry')}
 host.stop=()=>{events.push(['stop']);host.state='stopped';host.generation++;host.chunks=[];host.resumeNextPage=false}
 host.notify=message=>events.push(['notify',host.state,message]);host.fail=message=>{events.push(['fail',message]);host.state='stopped';return 'failed result'}
 host.speakCurrent=()=>events.push(['speak',...host.chunks]);host.adopt=value=>{events.push(['adopt',value]);host.chunks=value.items}
 host.prepareOpening=()=>{events.push(['opening']);if(trial%29===0)return Promise.reject(Error('opening'));if(trial%31===0)host.generation++;return Promise.resolve(plan)}
 host.prepareNext=generation=>{events.push(['next',generation]);if(trial%37===0)host.generation++;return Promise.resolve(trial%4===0?null:trial%3===0?plan:undefined)}
 const engine={refresh:()=>{events.push(['refresh']);if(trial%23===0)reject('refresh');return Promise.resolve().then(()=>{if(trial%11===0)reject('refresh async')})}}
 if(trial%5===0)delete engine.refresh
 const deps={
  load:()=>{events.push(['load']);if(trial%17===0)reject('load');return Promise.resolve().then(()=>{if(trial%13===0)reject('load async');if(trial%19===0)host.generation++})},
  engine:()=>{events.push(['engine']);return trial%9===0?null:engine},
  unlock:()=>{events.push(['unlock']);if(trial%43===0)reject('unlock')},
  native:()=>{events.push(['native']);return trial%5?{session:'session'}:null}
 }
 if(native){host.restartFromVisiblePage=()=>ui.voice_restart_visible(host);host.play=async()=>ui.voice_play(host,deps.load,deps.engine,deps.unlock,deps.native)}else configure(deps)
 return {host,events}
}
it('preserves synchronous and completed effects across 500 start, resume and cancellation scenarios',async()=>{
for(let trial=0;trial<500;trial++){
 const results=[]
 for(const native of [false,true]){
  const {host,events}=setup(native,trial),promise=host.play(),synchronous=structuredClone(events)
  let error='',value;try{value=await promise}catch(e){error=e.message}
  results.push({synchronous,error,value,events,state:host.state,generation:host.generation,chunks:host.chunks,session:host.nativeSession,waiting:host.waiting,opening:host.completeOpening,plan:host.openingPlan,resume:host.resumeNextPage,off:host.neuralOff})
 }
 assert.deepEqual(results[1],results[0],'scenario '+trial)
}

})
it('preserves the visible-page restart decision and return values',async()=>{
for(const state of ['stopped','paused','loading','playing'])for(const browsing of [false,true,'browsing'])for(const saved of [undefined,'wrong',JSON.stringify({page:2})]){
 const host={state,browsing,pausedLocation:saved,stoppedLocation:saved,reader:{location:{page:2}}}
 assert.equal(ui.voice_restart_visible(host),LegacyVoiceStart.prototype.restartFromVisiblePage.call(host))
}

})
it('releases start futures after repeated successful, failed and cancelled preparation',async()=>{
for(let round=0;round<2;round++){
 const before=core.memory.buffer.byteLength
 for(let trial=0;trial<1000;trial++){const {host}=setup(true,trial);try{await host.play()}catch{}}
 if(round)assert.equal(core.memory.buffer.byteLength,before)
}

})

it('delegates every start and the visible-page decision to the Rust functions',async()=>{
 const {host}=setup(false,1);host.restartFromVisiblePage=()=>restartVisibleVoice(host)
 const native={voice_method:vi.fn(ui.voice_method)};fixture.ui=native
 await playReadingVoice(host);expect(host.state).toBe('playing')
 host.state='paused';await playReadingVoice(host)
 const names=native.voice_method.mock.calls.map(call=>call[1]);expect(names.filter(name=>name==='play')).toHaveLength(2);expect(names).toContain('restartFromVisiblePage');expect(host.state).toBe('playing')
})
it('fails clearly without the core instead of starting through a second implementation',async()=>{
 const {host}=setup(false,1);fixture.ui=null
 await expect(playReadingVoice(host)).rejects.toThrow('Rust UI is not loaded');expect(()=>restartVisibleVoice(host)).toThrow('Rust UI is not loaded')
})
it('rejects a cyclic location before unlocking Android audio',async()=>{
 const {host,events}=setup(true,1);host.reader.location.self=host.reader.location
 await expect(host.play()).rejects.toThrow();expect(events).toEqual([['retry']])
})
it('cannot restart audio after Stop while the engine refresh is pending',async()=>{
 const {host,events}=setup(true,4);let finish
 const pending=ui.voice_play(host,()=>Promise.resolve(),()=>({refresh:()=>new Promise(resolve=>{finish=resolve})}),()=>{},()=>null)
 await vi.waitFor(()=>expect(finish).toBeTypeOf('function'))
 host.stop();finish();await pending
 expect(host.state).toBe('stopped');expect(events.some(row=>row[0]==='speak'||row[0]==='opening')).toBe(false)
})
