import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import * as ui from '../../src/wasm/ui/inhouse_read_ui.js'
import {it,expect,vi,afterEach} from 'vitest'
import {prepareVoiceOpening,prepareNextVoice,prepareVoicePlayback} from '../../src/js/readers/voice-preparation.js'
const fixture=vi.hoisted(()=>({ui:null,engine:null}))
vi.mock('../../src/js/rust-ui.js',()=>({getRustUI:()=>fixture.ui}))
vi.mock('../../src/js/readers/neural-runtime.js',()=>({neuralEngine:()=>fixture.engine}))
let planner,complete
function dependencies(engine,plan,first){fixture.engine=engine;planner=plan;complete=first}
vi.mock('../../src/js/readers/speech-text.js',()=>({planSpeech:(...args)=>planner(...args),firstCompleteSentenceOffset:(...args)=>complete(...args)}))
afterEach(()=>{fixture.ui=null;fixture.engine=null})
import {LegacyPreparation} from '../../src/js/readers/voice-preparation-legacy.js'
const core=ui.initSync({module:readFileSync('src/wasm/ui/inhouse_read_ui_bg.wasm')})
function snapshot(value){
 if(typeof value==='function')return 'function'
 if(Array.isArray(value))return value.map(snapshot)
 if(value&&typeof value==='object'){const out={};for(const [key,val] of Object.entries(value))if(key!=='promise')out[key]=snapshot(val);return out}
 return value
}
const methods={prepare:'voice_prepare',prepareOpening:'voice_prepare_opening',preparePlayback:'voice_prepare_playback',prepareNext:'voice_prepare_next',refreshPageBreaks:'voice_refresh_breaks'}
function setup(native,trial){
 const host=new LegacyPreparation(),events=[],effects={calls:0,prepares:0,complete:0,prime:0,extend:0,clear:0},sources=[]
 host.options={footnotes:trial%3===0,skipHeaders:trial%4===0};host.reader={location:{page:1}};host.openingLayout=0;host.completeOpening=trial%3===1;host.generation=3;host.state=['playing','loading','paused','stopped'][trial%4];host.voice='v';host.languageOverride='en';host.rate=1.5;host.index=0;host.utteranceId='u1';host.resumeNextPage=trial%19===0
 const sentence={start:0,end:300};host.items=[{text:'First.',start:0,end:30,sentence},{text:'Second.',start:30,end:70,sentence}];host.chunks=host.items.map(item=>item.text)
 host.restartFromVisiblePage=()=>trial%23===0
 host.prepareText=text=>{events.push(['text',text]);return text}
 host.voiceFor=text=>({voice:trial%13===0?null:{id:text==='Other.'?'other':'v',neural:trial%11!==0}})
 host.audioItem=item=>({...item,audio:true})
 host.upcomingFor=()=>({upcoming:[{text:'Next.'}],deferAfter:true})
 const source=(name,valid=true)=>{const value={name,text:'First. Second. \ud800',start:trial%3?8:0,previousText:'Before ',pageBreaks:trial%5?[30]:[],headerRanges:[[0,3]],clear(){effects.clear++;events.push(['clear',name])},isValid(){return valid}};sources.push(value);return value}
 host.source=source('current');host.source.measurePageBreaks=()=>{events.push(['measure']);if(trial%17===0)throw Error('measure');return Promise.resolve(trial%7?[30,80]:host.source.pageBreaks).then(value=>{if(trial%29===0)host.generation++;return value})}
 host.pagePlanValid=plan=>{events.push(['valid',plan?.source?.name]);return !plan?.source?.isValid||plan.source.isValid()===true}
 const planner=(text,options,from)=>{events.push(['plan',text,options,from]);effects.prepares++;if(trial%31===0)throw Error('planning');return [{text:'First.',start:from||0,end:45,sentence},{text:trial%3?'Second.':'Other.',start:45,end:90,sentence,marks:trial%5?undefined:[{offset:2}]}]}
 const complete=(...args)=>{events.push(['complete',...args]);effects.complete++;return 12}
 const engine={prime:args=>{events.push(['prime',args]);effects.prime++;if(trial%37===0)throw Error('prime');return Promise.resolve(trial%2?'ready':undefined)},extendUpcoming:args=>{events.push(['extend',args]);effects.extend++;if(trial%41===0)throw Error('extend')}}
 dependencies(trial%43?engine:null,planner,complete)
 const prepareNative=(value,opening=false)=>{try{return ui.voice_prepare(host,value,opening,planner,complete)}catch(error){return Promise.reject(error)}}
 const openingNative=()=>{try{return ui.voice_prepare_opening(host)}catch(error){return Promise.reject(error)}}
 if(native){host.prepare=prepareNative;host.prepareOpening=openingNative;host.preparePlayback=async(active=()=>true)=>ui.voice_prepare_playback(host,active,()=>trial%43?engine:null);host.prepareNext=async generation=>ui.voice_prepare_next(host,generation,(owner,generation)=>()=>ui.voice_next_active(owner,generation));host.refreshPageBreaks=async()=>ui.voice_refresh_breaks(host,()=>trial%43?engine:null)}
 host.reader.getSpeechText=()=>{events.push(['fallback']);return Promise.resolve('  one\n two \t three  \ud800 ')}
 host.reader.getSpeechSource=options=>{events.push(['get',options]);effects.calls++;if(trial%47===0)throw Error('source');let value=trial%4?source('opening'):null;if(trial%53===0)value=source('invalid',false);return trial%3?Promise.resolve(value):value}
 host.reader.getNextSpeechSource=options=>{events.push(['next',options.isActive()]);effects.calls++;if(trial%5===0&&effects.calls===1)throw new DOMException('changed','AbortError');if(trial%61===0)throw Error('next');let value=trial%11===0?null:trial%13===0?undefined:source('next-'+effects.calls,trial%7!==0||effects.calls>1);return Promise.resolve(value).then(value=>{if(trial%17===0)host.generation++;return value})}
 return {host,events,effects,sources,source,engine,planner,complete}
}
it('matches 1200 page preparation and cancellation scenarios with synchronous ordering',async()=>{
const totals={calls:0,prepares:0,complete:0,prime:0,extend:0,clear:0}
for(const method of Object.keys(methods))for(let trial=1;trial<=240;trial++){
 const results=[]
 for(const native of [false,true]){
  const env=setup(native,trial),{host,events,sources,source}=env;let result,error,sync
  try{
   const args=method==='prepare'?[trial%6===0?source('direct'):undefined,trial%2===0]:method==='prepareNext'?[host.generation]:method==='preparePlayback'?[()=>trial%7!==0]:[]
   const promise=host[method](...args);sync=snapshot(events);result=await promise
   if(result?.source)assert.ok(sources.includes(result.source))
  }catch(e){error={name:e.name,message:e.message}}
  await Promise.resolve();await Promise.resolve()
  if(native)for(const key in totals)totals[key]+=env.effects[key]
  results.push(snapshot({result,error,sync,events,source:host.source,items:host.items,chunks:host.chunks,index:host.index,generation:host.generation,openingPlan:host.openingPlan,preparingPage:host.preparingPage}))
 }
 assert.deepEqual(results[1],results[0],method+' '+trial)
}
for(const[key,value]of Object.entries(totals))assert.ok(value>10,key)
})
it('releases references after 1000 cached and next-page preparations',async()=>{
for(let trial=0;trial<10;trial++){const{host}=setup(true,trial+1);try{await host.prepareOpening();await host.prepareNext(host.generation)}catch{}}
await Promise.resolve()
const before=ui.ui_live_handles(),capacity=core.memory.buffer.byteLength
for(let i=0;i<1000;i++){const{host}=setup(true,i%200+1);try{await host.prepareOpening();await host.prepareNext(host.generation)}catch{};await Promise.resolve()}
assert.equal(ui.ui_live_handles(),before,'released host references')
assert.equal(core.memory.buffer.byteLength,capacity,'stable WASM memory')
})

it('shares the same opening analysis between warmup and Play',async()=>{
 const {host}=setup(false,1);fixture.ui=ui;let resolve
 const plan={source:{text:'One.'},items:[{text:'One.'}]}
 host.prepare=vi.fn(()=>new Promise(done=>{resolve=done}));host.pagePlanValid=()=>true
 const a=prepareVoiceOpening(host),b=prepareVoiceOpening(host)
 expect(host.prepare).toHaveBeenCalledOnce();resolve(plan)
 expect(await a).toBe(plan);expect(await b).toBe(plan)
})
it('ignores invalidated playback before synthesising any audio',async()=>{
 const {host,engine}=setup(false,1);fixture.ui=ui;fixture.engine=engine;host.state='stopped';host.resumeNextPage=false;host.restartFromVisiblePage=()=>false
 let resolve;host.prepareOpening=()=>new Promise(done=>{resolve=done});engine.prime=vi.fn()
 const pending=prepareVoicePlayback(host);host.rate=2;resolve({items:[{text:'One.'}]})
 expect(await pending).toBe(false);expect(engine.prime).not.toHaveBeenCalled()
})
it('clears a cancelled detached source and preserves a newer request',async()=>{
 const {host}=setup(false,1);fixture.ui=ui;host.state='playing';let resolve,active
 host.reader.getNextSpeechSource=options=>{active=options.isActive;return new Promise(done=>{resolve=done})}
 const pending=prepareNextVoice(host,host.generation);expect(active()).toBe(true)
 const newer={generation:++host.generation};host.preparingPage=newer
 expect(active()).toBe(false);const source={clear:vi.fn()};resolve(source)
 expect(await pending).toBeUndefined();expect(source.clear).toHaveBeenCalledOnce();expect(host.preparingPage).toBe(newer)
})
it('rebuilds the opening plan if the visible page changed while loading',async()=>{
 const {host}=setup(false,1);fixture.ui=ui;host.state='loading';let resolve
 const old={source:{text:'Old.'},items:[]},next={source:{text:'New.'},items:[{text:'New.'}]}
 host.prepare=vi.fn().mockImplementationOnce(()=>new Promise(done=>{resolve=done})).mockResolvedValue(next)
 host.prepareOpening=()=>prepareVoiceOpening(host);host.pagePlanValid=()=>true
 const pending=prepareVoiceOpening(host);host.reader.location={page:2};resolve(old)
 expect(await pending).toBe(next);expect(host.prepare).toHaveBeenCalledTimes(2)
})
