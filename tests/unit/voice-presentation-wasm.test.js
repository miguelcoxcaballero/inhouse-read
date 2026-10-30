import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {it,expect,vi,afterEach} from 'vitest'
import * as ui from '../../src/wasm/ui/inhouse_read_ui.js'
// The session's methods (reading-voice.js) called on the fixture host, as the former wrapper modules did.
import {ReadingVoice} from '../../src/js/readers/reading-voice.js'
const method=name=>(host,...args)=>ReadingVoice.prototype[name].call(host,...args)
const presentVoice=method('present')
const fixture=vi.hoisted(()=>({ui:null,native:null}))
vi.mock('../../src/js/rust-ui.js',()=>({getRustUI:()=>fixture.ui}))
vi.mock('../../src/js/readers/neural-voice/audio.js',()=>({nativeAudio:()=>fixture.native}))
const setNative=value=>{fixture.native=value}
afterEach(()=>{fixture.ui=null;fixture.native=null;globalThis.clearTimeout=originalClear})
import {LegacyVoicePresentation} from './helpers/reference-voice-presentation.js'
const core=ui.initSync({module:readFileSync('src/wasm/ui/inhouse_read_ui_bg.wasm')})
const originalClear=globalThis.clearTimeout,ignore=value=>Promise.resolve(value).catch(()=>{})
function setup(native,trial){
 const host=new LegacyVoicePresentation(),events=[]
 const source=(name,activation)=>({name,activate:activation?()=>{events.push(['activate',name]);if(trial%17===0)throw Error('invalidated');return [true,false,true,1,undefined][Math.floor(trial/5)%5]}:undefined,
  clear(){events.push(['clear',name]);if(trial%23===0)throw Error('old source')},highlight(start,end){events.push(['highlight',name,start,end]);if(trial%11===0)throw Error('no highlight')},follow(start,end){events.push(['follow',name,start,end]);return trial%19===0?Promise.reject(Error('stale follow')):undefined}})
 const current=source('current',trial%3===0),next=source('next',trial%4===0),old=source('old',false),sentence={start:0,end:200}
 host.state=trial%7?'playing':'paused';host.utteranceId='u1';host.startedId=trial%5?'u1':'old';host.source=current;host.nativeSession='session';host.waiting=trial%3===0;host.waitTimer=14;host.presentTimer=21;host.neuralRetries=3;host.index=0;host.reader={speechPosition:{index:trial%13?2:2.5,kind:'pdf'}}
 host.items=[{text:'Full continuous sentence.',sentence,start:0,end:200,marks:trial%7?[
  {offset:50,start:50},{offset:100,start:0,source:next,sentence:{start:0,end:100}},{offset:150,start:50,source:next}]:undefined}]
 if(trial%4===1)host.shown={source:current,start:0,end:200};else if(trial%4===2)host.shown={source:old,start:0,end:200}
 host.pause=()=>{events.push(['pause']);host.state='paused'};host.notify=(...args)=>events.push(['notify',...args]);host.prepareAhead=()=>events.push(['ahead'])
 const bridge={session:trial%29?'session':'old',bridge:{mark(...args){events.push(['mark',...args]);if(trial%31===0)throw Error('native disconnected')}}};setNative(bridge)
 const clear=timer=>events.push(['timer',timer]);globalThis.clearTimeout=clear
 if(native){host.present=(id=host.utteranceId,offset=0)=>ui.voice_present(host,id,offset,clear,ignore);host.engineStarted=id=>ui.voice_engine_started(host,id,clear,()=>bridge);host.engineEnded=id=>ui.voice_engine_ended(host,id);host.unpaint=()=>ui.voice_unpaint(host,clear)}
 return {host,events,current,next,old}
}
it('matches 1000 audible presentation, highlighting and lifecycle scenarios',async()=>{
const totals={highlight:0,follow:0,ahead:0,mark:0,pause:0}
for(let trial=0;trial<1000;trial++){
 const results=[]
 for(const native of [false,true]){
  const {host,events,current,next,old}=setup(native,trial),method=['present','engineStarted','engineEnded','unpaint'][trial%4];let error
  try{host[method](trial%9?'u1':'old',[0,50,100,150,75][Math.floor(trial/4)%5])}catch(e){error=e.message}
  await Promise.resolve();await Promise.resolve()
  if(native)for(const event of events)if(event[0] in totals)totals[event[0]]++
  if(host.shown)assert.ok([current,next,old].includes(host.shown.source))
  results.push({events,error,state:host.state,started:host.startedId,waiting:host.waiting,retries:host.neuralRetries,deferred:host.deferredPage,shown:host.shown&&{source:host.shown.source.name,start:host.shown.start,end:host.shown.end}})
 }
 assert.deepEqual(results[1],results[0],'scenario '+trial)
}
for(const value of Object.values(totals))assert.ok(value>10)
})
it('releases allocations over 2000 presentation and cleanup cycles',async()=>{
for(let round=0;round<2;round++){
 const before=core.memory.buffer.byteLength
 for(let trial=0;trial<1000;trial++){const {host}=setup(true,trial);host.present('u1',trial%3?0:100);try{host.unpaint()}catch{};await Promise.resolve()}
 if(round)assert.equal(core.memory.buffer.byteLength,before)
}
})

it('waits for audible start before activating or highlighting a detached page',()=>{
 const {host,next}=setup(false,1);host.source=next;host.state='playing';host.startedId='old';next.activate=vi.fn(()=>true);next.highlight=vi.fn();fixture.ui=ui
 presentVoice(host,'u1');expect(next.activate).not.toHaveBeenCalled();expect(next.highlight).not.toHaveBeenCalled()
 host.startedId='u1';presentVoice(host,'u1');expect(next.activate).toHaveBeenCalledOnce();expect(next.highlight).toHaveBeenCalledWith(0,200)
 expect(host.shown.source).toBe(next)
})
it('keeps a full sentence highlighted while following marks in the same source',()=>{
 const {host,current}=setup(false,1);host.state='playing';host.shown=null;current.highlight=vi.fn();current.follow=vi.fn();fixture.ui=ui
 presentVoice(host,'u1',0);const shown=host.shown;presentVoice(host,'u1',50)
 expect(current.highlight).toHaveBeenCalledOnce();expect(host.shown).toBe(shown)
 expect(current.follow.mock.calls).toEqual([[0,50],[50,200]])
})
it('preserves source identity when presentation adopts a late native module',()=>{
 const {host,current}=setup(false,1);host.shown=null;const native={...ui,voice_present:vi.fn(ui.voice_present)};fixture.ui=native
 presentVoice(host);expect(native.voice_present).toHaveBeenCalledOnce();expect(host.shown.source).toBe(current)
})
