import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {it,expect,vi,afterEach} from 'vitest'
import * as ui from '../../src/wasm/ui/inhouse_read_ui.js'
// The session's methods (reading-voice.js) called on the fixture host, as the former wrapper modules did.
import {ReadingVoice} from '../../src/js/readers/reading-voice.js'
const method=name=>(host,...args)=>ReadingVoice.prototype[name].call(host,...args)
const prepareVoiceAhead=method('prepareAhead')
const fixture=vi.hoisted(()=>({ui:null,engine:null}))
vi.mock('../../src/js/rust-ui.js',()=>({getRustUI:()=>fixture.ui}))
vi.mock('../../src/js/readers/neural-runtime.js',()=>({neuralEngine:()=>fixture.engine}))
const setEngine=value=>{fixture.engine=value}
afterEach(()=>{fixture.ui=null;fixture.engine=null})
import {LegacyVoiceAhead} from './helpers/reference-voice-ahead.js'
const core=ui.initSync({module:readFileSync('src/wasm/ui/inhouse_read_ui_bg.wasm')})
function setup(native,trial){
 const host=new LegacyVoiceAhead(),events=[];let current
 const source={physicalPage:7},next={text:'Continuation.',clear(){events.push(['clear'])},isValid:()=>trial%17!==0,activate:()=>true,adopt(){events.push(['adopt'])}}
 const items=[{text:'Next fragment.',sentence:{start:0,end:14}},{text:'Another.'}]
 host.state=trial%5===0?'paused':'playing';host.source=source;host.generation=3;host.index=trial%6;host.chunks=Array.from({length:trial%8+1},(_,i)=>'Fragment '+i);host.rate=1.5;host.utteranceId='u1';host.deferredPage=trial%19===0?next:null
 host.prepare=async page=>{assert.equal(page,next);events.push(['prepare']);if(trial%11===0)throw new Error('prepare failed');if(trial%13===0)host.generation++;return {source:page,items}}
 host.reader={getNextSpeechSource:async request=>{current=request;events.push(['next',request.afterPage,request.isActive()]);if(trial%23===0)throw new DOMException('Stale','AbortError');if(trial%29===0)host.state='paused';if(trial%31===0)return null;if(trial%37===0)return undefined;return next}}
 host.voiceFor=text=>{events.push(['voice',text]);return {voice:trial%7===0?null:{id:'natural'}}};host.upcomingFor=voice=>{events.push(['upcoming',voice]);return {upcoming:['Next'],deferAfter:'Later'}}
 host.joinPageSentence=()=>events.push(['join']);host.prepareNext=async generation=>{events.push(['prepareNext',generation]);return {source:next,items}}
 const engine={extendUpcoming:request=>{events.push(['extend',request]);if(trial%41===0)throw Error('engine failed')}};setEngine(engine)
 if(native){host.prepareAhead=()=>ui.voice_prepare_ahead(host,(owner,request)=>()=>ui.voice_ahead_active(owner,request),()=>engine);host.clearAhead=()=>ui.voice_clear_ahead(host);host.pagePlanValid=plan=>ui.voice_page_valid(plan);host.revalidateNext=async(plan,g)=>ui.voice_revalidate_next(host,plan,g);host.adopt=plan=>ui.voice_adopt_plan(host,plan)}
 if(trial%43===0)host.aheadPage={error:{name:'AbortError'},plan:{source:next}}
 else if(trial%47===0)host.aheadPage={plan:{source:next}}
 return {host,events,source,next,items,active:()=>current?.isActive()}
}
it('matches 700 detached preparation and cancellation scenarios',async()=>{
const totals={prepared:0,extended:0,cancelled:0}
for(let trial=0;trial<700;trial++){
 const results=[]
 for(const native of [false,true]){
  const {host,events,source,next,items,active}=setup(native,trial);host.prepareAhead();const request=host.aheadPage
  if(trial%3===0&&request){host.clearAhead();if(native)totals.cancelled++}
  const result=await request?.promise
  if(native&&events.some(e=>e[0]==='prepare'))totals.prepared++
  if(native&&events.some(e=>e[0]==='extend'))totals.extended++
  if(result){assert.equal(result.source,next);assert.equal(result.items,items)}
  results.push({events,active:active(),result:result==null?result:{items:result.items},request:request&&{cancelled:request.cancelled,error:request.error?.name,message:request.error?.message,plan:request.plan==null?request.plan:{items:request.plan.items}},state:host.state,generation:host.generation,aheadPresent:!!host.aheadPage})
 }
 assert.deepEqual(results[1],results[0],'scenario '+trial)
}
assert.ok(totals.prepared>100);assert.ok(totals.extended>30);assert.ok(totals.cancelled>50)
})
it('matches 100 validation and adoption scenarios without copying sources',async()=>{
for(let trial=0;trial<100;trial++){
 const results=[]
 for(const native of [false,true]){
  const {host,next,items,events}=setup(native,trial),plan={source:next,items}
  const output=await host.revalidateNext(plan,trial%3?host.generation:0)
  if(output===plan)assert.equal(output.items,items)
  host.adopt(plan);assert.equal(host.source,next);assert.equal(host.items,items);assert.equal(host.deferredPage,next)
  results.push({events,result:output&&output.items,chunks:host.chunks,index:host.index,valid:host.pagePlanValid(plan)})
 }
 assert.deepEqual(results[1],results[0],'adopt '+trial)
}
})
it('releases allocations after 2000 detached preparations',async()=>{
for(let round=0;round<2;round++){
 const before=core.memory.buffer.byteLength
 for(let trial=0;trial<1000;trial++){const {host}=setup(true,trial);host.prepareAhead();await host.aheadPage?.promise;host.clearAhead()}
 if(round)assert.equal(core.memory.buffer.byteLength,before)
}
})

it('does not adopt or extend a page that resolves after cancellation',async()=>{
 const {host,next}=setup(true,1);let resolve;let active
 host.reader.getNextSpeechSource=request=>{active=request.isActive;return new Promise(done=>{resolve=done})}
 host.prepare=vi.fn();host.prepareAhead();const request=host.aheadPage;expect(active()).toBe(true)
 host.clearAhead();expect(active()).toBe(false);resolve(next);expect(await request.promise).toBeUndefined()
 expect(host.prepare).not.toHaveBeenCalled();expect(host.aheadPage).toBeNull()
})
it('preserves sparse chunks and source lifecycle call order',()=>{
 const events=[],source={adopt(){events.push('adopt')},activate(){}};const items=new Array(4);items[1]={text:'😀'};items[3]={text:'Last'}
 const host={};ui.voice_adopt_plan(host,{source,items})
 expect(events).toEqual(['adopt']);expect(host.source).toBe(source);expect(host.items).toBe(items)
 expect(host.chunks).toEqual([, '😀',, 'Last']);expect(host.deferredPage).toBe(source);expect(host.index).toBe(0)
})
it('accepts only an explicitly valid detached page and catches stale getters',()=>{
 for(const isValid of [()=>true,()=>false,()=>1,()=>Promise.resolve(true),true,null,undefined]){
  const plan={source:{isValid}};expect(ui.voice_page_valid(plan)).toBe(new LegacyVoiceAhead().pagePlanValid(plan))
 }
 expect(ui.voice_page_valid({get source(){throw Error('detached')}})).toBe(false)
})
it('adopts native preparation after a late module without moving the current source',async()=>{
 const {host,source}=setup(false,1);const native={...ui,voice_method:vi.fn(ui.voice_method)};fixture.ui=native
 prepareVoiceAhead(host);await host.aheadPage.promise
 expect(native.voice_method).toHaveBeenCalledOnce();expect(native.voice_method.mock.calls[0].slice(0,2)).toEqual([host,'prepareAhead']);expect(host.source).toBe(source)
})
