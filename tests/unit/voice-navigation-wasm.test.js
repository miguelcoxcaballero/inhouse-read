import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {it,expect,vi,afterEach} from 'vitest'
import * as ui from '../../src/wasm/ui/inhouse_read_ui.js'
import {browseVoice,returnVoiceAudio,seekVoicePoint} from '../../src/js/readers/voice-navigation.js'
const fixture=vi.hoisted(()=>({ui:null}))
vi.mock('../../src/js/rust-ui.js',()=>({getRustUI:()=>fixture.ui}))
afterEach(()=>{fixture.ui=null})
import {LegacyVoiceNavigation} from '../../src/js/readers/voice-navigation-legacy.js'
const core=ui.initSync({module:readFileSync('src/wasm/ui/inhouse_read_ui_bg.wasm')})
const add=(a,b)=>a+b
function setup(native,trial){
 const host=new LegacyVoiceNavigation(),events=[],sentence={start:0,end:60},next={start:60,end:120}
 const original=[{start:0,end:20,sentence},{start:20,end:40,sentence},{start:40,end:60,sentence},{start:60,end:90,sentence:next},{start:90,end:120,sentence:next}]
 host.state=['playing','paused','loading','stopped'][trial%4];host.generation=5;host.browseEpoch=trial%3?trial:undefined;host.browsing=trial%3===0;host.index=3;host.items=original
 const source={text:'😀 A physical page.',start:12,offsetAtPoint(doc,x,y){events.push(['offset',doc,x,y]);if(trial%17===0)throw Error('stale frame');return [5,21,65,105,121,-1,NaN,Infinity,'3',undefined][Math.floor(trial/20)%10]}}
 host.source=source;host.reader={browseSpeech(){events.push(['browse']);if(trial%19===0)throw Error('browse failed')},async returnToSpeech(){events.push(['return']);if(trial%13===0)throw Error('return failed');if(trial%7===0)host.browseEpoch++;if(trial%11===0)host.generation++},async getSpeechSource(request){events.push(['source',request]);if(trial%13===0)throw Error('source failed');if(trial%11===0)host.generation++;return source}}
 host.prepare=async input=>{assert.equal(input.offsetAtPoint,source.offsetAtPoint);events.push(['prepare',{text:input.text,start:input.start}]);if(trial%23===0)throw Error('plan failed');if(trial%7===0)host.generation++;return {items:original}}
 host.stop=()=>{events.push(['stop']);host.generation++;host.state='stopped'}
 host.adopt=plan=>{events.push(['adopt',{items:plan.items}]);assert.equal(plan.source,source);for(const item of plan.items)assert.ok(original.includes(item));host.items=plan.items;host.index=0}
 host.restart=()=>events.push(['restart']);host.notify=(...args)=>events.push(['notify',...args]);host.speakCurrent=()=>events.push(['speak'])
 if(native){host.browse=()=>ui.voice_browse(host,add);host.returnToAudio=async()=>ui.voice_return_audio(host);host.continueFromPage=async navigate=>ui.voice_continue_page(host,navigate);host.jumpToPoint=({doc,x,y}={})=>ui.voice_jump_point(host,doc,x,y);host.seekToPoint=async({doc,x,y})=>ui.voice_seek_point(host,doc,x,y)}
 return {host,events,original,source}
}
it('matches 1000 browsing, return and phrase-seek scenarios',async()=>{
const totals={seek:0,jump:0}
for(let trial=0;trial<1000;trial++){
 const results=[]
 for(const native of [false,true]){
  const {host,events}=setup(native,trial);const method=['browse','returnToAudio','continueFromPage','jumpToPoint','seekToPoint'][Math.floor(trial/4)%5];let value,error
  try{value=await host[method](method==='continueFromPage'?async()=>{events.push(['navigate']);if(trial%7===0)throw Error('navigation failed')}:{doc:'retained document',x:12,y:56})}catch(e){error=e.message}
  if(native&&events.some(e=>e[0]==='adopt'))totals.seek++
  if(native&&value===true&&method==='jumpToPoint')totals.jump++
  results.push({value,error,events,state:host.state,generation:host.generation,index:host.index,browsing:host.browsing,epoch:host.browseEpoch,items:host.items,waiting:host.waiting})
 }
 assert.deepEqual(results[1],results[0],'scenario '+trial)
}
assert.ok(totals.seek>10);assert.ok(totals.jump>10)
})
it('releases allocations over 2000 asynchronous seeks and returns',async()=>{
for(let round=0;round<2;round++){
 const before=core.memory.buffer.byteLength
 for(let trial=0;trial<1000;trial++){const {host}=setup(true,trial);await host.seekToPoint({doc:null,x:0,y:0});try{await host.returnToAudio()}catch{}}
 if(round)assert.equal(core.memory.buffer.byteLength,before)
}
})

it('keeps listening intact while browsing and ignores a superseded return',async()=>{
 const {host}=setup(false,33);host.state='playing';host.browsing=false;host.browseEpoch=0
 const source=host.source,items=host.items;host.notify=vi.fn();host.reader.browseSpeech=vi.fn()
 fixture.ui=ui;browseVoice(host);expect(host.source).toBe(source);expect(host.items).toBe(items);expect(host.index).toBe(3)
 let release;host.reader.returnToSpeech=()=>new Promise(resolve=>{release=resolve})
 const pending=returnVoiceAudio(host);browseVoice(host);release();await pending
 expect(host.browsing).toBe(true);expect(host.index).toBe(3)
 host.reader.returnToSpeech=()=>Promise.resolve();await returnVoiceAudio(host);expect(host.browsing).toBe(false)
})
it('does not adopt a phrase after Stop invalidates its asynchronous preparation',async()=>{
 const {host}=setup(false,33);host.state='playing';host.reader.getSpeechSource=async()=>host.source;host.source.offsetAtPoint=()=>21
 let release;host.prepare=()=>new Promise(resolve=>{release=resolve});host.adopt=vi.fn();host.speakCurrent=vi.fn();fixture.ui=ui
 const pending=seekVoicePoint(host,{doc:null,x:1,y:2});await Promise.resolve();await Promise.resolve();await Promise.resolve()
 expect(release).toBeTypeOf('function');host.stop();release({items:host.items});await pending
 expect(host.adopt).not.toHaveBeenCalled();expect(host.speakCurrent).not.toHaveBeenCalled()
})
it('adopts a late native navigator without recreating the reader or its source',async()=>{
 const {host}=setup(false,33);host.state='playing';const source=host.source,reader=host.reader
 const native={...ui,voice_browse:vi.fn(ui.voice_browse)};fixture.ui=native;browseVoice(host)
 expect(native.voice_browse).toHaveBeenCalledOnce();expect(host.source).toBe(source);expect(host.reader).toBe(reader)
})
