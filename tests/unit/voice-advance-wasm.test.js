import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import * as ui from '../../src/wasm/ui/inhouse_read_ui.js'
import {it,expect,vi,afterEach} from 'vitest'
import {advanceVoice} from '../../src/js/readers/voice-advance.js'
const fixture=vi.hoisted(()=>({ui:null}))
vi.mock('../../src/js/rust-ui.js',()=>({getRustUI:()=>fixture.ui}))
afterEach(()=>{fixture.ui=null;globalThis.setTimeout=originalSet})
const originalSet=globalThis.setTimeout
function dependencies(sleeper){globalThis.setTimeout=(done,ms)=>{sleeper(ms).then(done);return 1}}
import {LegacyAdvance} from '../../src/js/readers/voice-advance-legacy.js'
const core=ui.initSync({module:readFileSync('src/wasm/ui/inhouse_read_ui_bg.wasm')})
function setup(native,trial){
 const host={state:trial%13?'playing':'paused',generation:3,index:trial%4?1:0,chunks:['First.','Last.'],reader:{location:{page:1}},diagnosticAdvance:null},events=[],sources=[]
 let nextCount=0,prepareCount=0
 const source=name=>{const value={name,clear(){events.push(['clear',name]);if(trial%43===0)throw Error('clear')}};sources.push(value);return value}
 const plan=name=>({source:source(name),items:trial%3?[{text:'Next.'}]:[]})
 host.speakCurrent=()=>{events.push(['speak']);return 'spoken'};host.advance=async()=>{events.push(['recursive']);return 'continued'}
 host.stop=()=>{events.push(['stop']);host.state='stopped'};host.notify=message=>events.push(['notify',message]);host.fail=message=>{events.push(['fail',message]);host.state='paused';if(trial%101===0)throw Error('failure')}
 host.prepareNext=generation=>{events.push(['prepare-next',generation,host.diagnosticAdvance?.stage]);if(trial%71===0)throw Error('prepare-next');return Promise.resolve(trial%5===0?null:trial%7===0?undefined:plan('next')).then(value=>{if(trial%29===0)host.generation++;return value})}
 host.pagePlanValid=value=>{events.push(['valid',value?.source?.name]);return !value||trial%11!==0}
 host.revalidateNext=(value,generation)=>{events.push(['revalidate',value?.source?.name,generation]);return Promise.resolve(trial%17?plan('valid'):null).then(value=>{if(trial%19===0)host.generation++;return value})}
 host.adopt=value=>{events.push(['adopt',value.source.name]);host.source=value.source;host.items=value.items;host.chunks=value.items.map(item=>item.text);host.index=0}
 if(trial%2)host.reader.getNextSpeechSource=()=>{}
 if(trial%6===1)host.aheadPage={promise:Promise.resolve(trial%7?plan('ahead'):undefined),error:trial%5?undefined:Object.assign(Error('ahead'),{name:trial%3?'AbortError':'Error'})}
 host.reader.next=options=>{nextCount++;events.push(['turn',options.source,options.isActive(),host.diagnosticAdvance?.stage]);if(trial%61===0)throw Error('turn');if(trial%5&&nextCount>trial%3)host.reader.location={page:host.reader.location.page+1};return Promise.resolve().then(()=>{if(trial%31===0)host.generation++})}
 host.prepare=()=>{prepareCount++;events.push(['prepare',host.diagnosticAdvance?.stage]);return Promise.resolve(trial%3?{source:source('visible'),items:[{text:'Visible.'}]}:{source:source('empty'),items:[]}).then(value=>{if(trial%37===0)host.generation++;return value})}
 const sleep=ms=>{events.push(['wait',ms]);if(trial%23===0)host.generation++;return Promise.resolve()};dependencies(sleep)
 const run=()=>native?ui.voice_advance(host,(owner,generation)=>()=>ui.voice_advance_active(owner,generation),sleep):LegacyAdvance.prototype.advance.call(host)
 return {host,events,run:async()=>run(),sources,counts:()=>({nextCount,prepareCount})}
}
it('matches 1200 advancement and cancellation scenarios including synchronous errors',async()=>{
const totals={speak:0,recursive:0,stop:0,fail:0,'prepare-next':0,revalidate:0,adopt:0,turn:0,wait:0,prepare:0,clear:0}
for(let trial=1;trial<=1200;trial++){
 const results=[]
 for(const native of [false,true]){
  const{host,events,run,counts,sources}=setup(native,trial);let result,error,sync
  try{const pending=run();sync=structuredClone(events);result=await pending}catch(e){error=e.message}
  if(host.source)assert.ok(sources.includes(host.source))
  if(native)for(const event of events)if(event[0] in totals)totals[event[0]]++
  results.push({result,error,sync,events,counts:counts(),state:host.state,generation:host.generation,index:host.index,chunks:host.chunks,source:host.source?.name,preparing:host.preparingPage,diagnostic:host.diagnosticAdvance,hasAhead:!!host.aheadPage})
 }
 assert.deepEqual(results[1],results[0],'advance '+trial)
}
for(const[key,value]of Object.entries(totals))assert.ok(value>0,key)
})
it('releases references across 1000 automatic advances',async()=>{
for(let i=0;i<20;i++)try{await setup(true,i+1).run()}catch{}
await Promise.resolve();const before=ui.ui_live_handles(),capacity=core.memory.buffer.byteLength
for(let i=0;i<1000;i++){try{await setup(true,i%200+1).run()}catch{};await Promise.resolve()}
assert.equal(ui.ui_live_handles(),before);assert.equal(core.memory.buffer.byteLength,capacity)
})

it('never adopts a detached page completed after Stop',async()=>{
 const {host}=setup(false,1);fixture.ui=ui;host.aheadPage=null
 let resolve;host.prepareNext=()=>new Promise(done=>{resolve=done});host.adopt=vi.fn()
 const pending=advanceVoice(host);host.state='stopped';host.generation++
 const source={clear:vi.fn()};resolve({source,items:[{text:'Next.'}]})
 await pending;expect(source.clear).toHaveBeenCalledOnce();expect(host.adopt).not.toHaveBeenCalled();expect(host.diagnosticAdvance).toBeNull()
})
it('keeps a newer preparation owner when an older ahead promise finishes',async()=>{
 const {host}=setup(false,1);fixture.ui=ui
 let resolve;host.aheadPage={promise:new Promise(done=>{resolve=done})}
 const pending=advanceVoice(host),newer={generation:99};host.preparingPage=newer
 resolve(null);await pending;expect(host.preparingPage).toBe(newer);expect(host.state).toBe('stopped')
})
