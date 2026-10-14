import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import * as ui from '../../src/wasm/ui/inhouse_read_ui.js'
import {it,expect,vi,afterEach} from 'vitest'
import {dispatchVoice,dispatchNeuralVoice} from '../../src/js/readers/voice-dispatch.js'
const fixture=vi.hoisted(()=>({ui:null,engine:null,native:null,voices:[]}))
vi.mock('../../src/js/rust-ui.js',()=>({getRustUI:()=>fixture.ui}))
vi.mock('../../src/js/readers/neural-runtime.js',()=>({neuralEngine:()=>fixture.engine,neuralVoiceList:()=>fixture.voices}))
vi.mock('../../src/js/readers/neural-voice/audio.js',()=>({nativeAudio:()=>fixture.native}))
vi.mock('../../src/js/readers/voice-catalog.js',()=>({langBase:language=>language.split('-')[0],isNeuralId:id=>id.startsWith('piper:')}))
function dependencies(engine,native,voices){fixture.engine=engine;fixture.native=native;fixture.voices=voices}
import {LegacyDispatch} from './helpers/reference-voice-dispatch.js'
const core=ui.initSync({module:readFileSync('src/wasm/ui/inhouse_read_ui_bg.wasm')})
const original={now:Date.now,clear:globalThis.clearTimeout,set:globalThis.setTimeout}
const ignore=value=>Promise.resolve(value).catch(()=>{})
const base=language=>language.split('-')[0],isNeural=id=>id.startsWith('piper:')
function setup(native,trial){
 const events=[],callbacks=[];let timerId=100
 const clear=id=>events.push(['clear',id]),timer=(callback,ms)=>{events.push(['timer',ms]);callbacks.push(callback);return ++timerId}
 globalThis.clearTimeout=clear;globalThis.setTimeout=timer;Date.now=()=>100000+trial
 const voice={id:'piper:en',neural:trial%3!==0},host={state:trial%7?'playing':'paused',generation:3,index:1,spoken:trial%5?2:undefined,voice:trial%3?'piper:en':'',utteranceId:'old',startedId:trial%5?'old':'x',waiting:trial%2===0,neuralRetries:trial%5,transport:trial%11?'neural':null,waitTimer:21,presentTimer:22,sleepTimer:23,nativeSession:'previous',missing:new Set(),rate:2}
 host.items=[{text:'One.'},{text:'Two.',marks:trial%4?undefined:[{offset:3},{offset:8}],joinChecked:trial%6===0}];host.chunks=host.items.map(item=>item.text);host.spokenWith=voice
 host.needsPageJoin=()=>trial%4===0;host.prepareAhead=()=>{events.push(['ahead']);if(trial%5)host.aheadPage={promise:Promise.resolve()}}
 host.joinPageSentence=()=>events.push(['join']);host.speakCurrent=()=>events.push(['speak-current'])
 host.voiceFor=text=>{events.push(['voice',text]);return {language:trial%2?'en-US':'es-ES',voice:trial%13?voice:null}}
 host.speakNeural=(...args)=>events.push(['neural',...args]);host.useTransport=value=>{events.push(['transport',value]);host.transport=value}
 host.upcomingFor=()=>({upcoming:[{text:'Three.'}],deferAfter:true})
 host.fail=message=>{events.push(['fail',message]);host.state='paused'};host.pause=()=>{events.push(['pause']);host.state='paused'};host.stop=()=>{events.push(['stop']);host.state='stopped'};host.notify=(...args)=>events.push(['notify',...args]);host.engineFailed=detail=>events.push(['failed',detail])
 const engine=trial%17?{speak(args){events.push(['speak',args]);if(trial%19===0)throw Error('speech')},stop(){events.push(['engine-stop']);if(trial%23===0)throw Error('stopped')},refresh(){events.push(['refresh']);return trial%29?Promise.resolve():Promise.reject(Error('refresh'))}}:null
 const bridge=trial%5?{session:'session'}:null,voices=trial%3?[{base:'en'}]:[]
 dependencies(engine,bridge,voices)
 const invoke=(method,args)=>{
  if(!native)return LegacyDispatch.prototype[method].apply(host,args)
  if(method==='speakCurrent')return ui.voice_speak_current(host,()=>voices,base,isNeural,Date.now,(owner,promise,generation,index)=>{void promise.then(()=>ui.voice_join_ready(owner,generation,index))})
  if(method==='speakNeural')return ui.voice_speak_neural(host,...args,()=>engine,()=>bridge,clear,(owner,id)=>timer(()=>ui.voice_wait_started(owner,id),900),(owner,id)=>queueMicrotask(()=>owner.engineFailed({id,reason:'synth-failed'})))
  if(method==='engineFailed')return ui.voice_engine_failed(host,args[0],clear,()=>engine,ignore)
  if(method==='voiceRemoved')return ui.voice_removed(host,args[0])
  if(method==='setSleep')return ui.voice_set_sleep(host,args[0],clear,(owner,ms)=>timer(()=>ui.voice_sleep_expired(owner),ms))
 }
 return {host,events,callbacks,invoke,voice}
}
afterEach(()=>{fixture.ui=null;Date.now=original.now;globalThis.clearTimeout=original.clear;globalThis.setTimeout=original.set})
it('matches 1500 dispatch, retry, removal and sleep cases',async()=>{
const totals={ahead:0,neural:0,speak:0,failed:0,refresh:0,pause:0,join:0,timer:0,notify:0}
for(const method of ['speakCurrent','speakNeural','engineFailed','voiceRemoved','setSleep'])for(let trial=1;trial<=300;trial++){
 const results=[]
 for(const native of [false,true]){
  const{host,events,callbacks,invoke,voice}=setup(native,trial);let result,error
  const args=method==='speakCurrent'?[]:method==='speakNeural'?['old','Two.',voice]:method==='engineFailed'?[{id:trial%31?'old':'stale',reason:['synth-failed','init-failed','not-installed','other',undefined][trial%5]}]:method==='voiceRemoved'?[trial%3?'piper:en':'piper:other']:[[-1,0,1,3.5,undefined][trial%5]]
  try{result=invoke(method,args)}catch(e){error=e.message}
  if(trial%17===0)host.generation++;if(trial%29===0)host.state='stopped'
  await Promise.resolve();await Promise.resolve();await Promise.resolve()
  for(const callback of callbacks)callback()
  if(native)for(const event of events)if(event[0] in totals)totals[event[0]]++
  results.push({result,error,events,state:host.state,spoken:host.spoken,id:host.utteranceId,voice:host.spokenWith,off:host.neuralOff,retries:host.neuralRetries,waiting:host.waiting,missing:[...host.missing],session:host.nativeSession,items:host.items})
 }
 assert.deepEqual(results[1],results[0],method+' '+trial)
}
for(const[key,value]of Object.entries(totals))assert.ok(value>0,key)
})
it('releases references across 2000 dispatch and timer cycles',async()=>{
for(let i=0;i<10;i++){const{invoke,voice,callbacks}=setup(true,1);invoke('speakCurrent',[]);invoke('speakNeural',['old','Two.',voice]);for(const cb of callbacks)cb();await Promise.resolve()}
const before=ui.ui_live_handles(),capacity=core.memory.buffer.byteLength
for(let i=0;i<2000;i++){const{invoke,voice,callbacks}=setup(true,i%200+1);invoke('speakCurrent',[]);invoke('speakNeural',['old','Two.',voice]);for(const cb of callbacks)cb();await Promise.resolve();await Promise.resolve()}
assert.equal(ui.ui_live_handles(),before);assert.equal(core.memory.buffer.byteLength,capacity)
})

it('discards a page-join callback after the listening generation changes',async()=>{
 const{host}=setup(false,4);fixture.ui=ui
 let resolve;host.prepareAhead=()=>{host.aheadPage={promise:new Promise(done=>{resolve=done})}}
 host.joinPageSentence=vi.fn();host.speakCurrent=vi.fn()
 dispatchVoice(host);host.generation++;resolve();await Promise.resolve();await Promise.resolve()
 expect(host.joinPageSentence).not.toHaveBeenCalled();expect(host.speakCurrent).not.toHaveBeenCalled()
})
it('does not replace audible status with preparing after the engine started',()=>{
 const{host,voice,callbacks}=setup(false,1);fixture.ui=ui;host.waiting=false;host.startedId=undefined
 host.notify=vi.fn();dispatchNeuralVoice(host,'old','Two.',voice);host.startedId='old'
 callbacks.at(-1)();expect(host.notify).not.toHaveBeenCalled();expect(host.waiting).toBe(false)
})
