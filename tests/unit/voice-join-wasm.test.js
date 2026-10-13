import assert from 'node:assert/strict'
import {it,expect,vi,afterEach} from 'vitest'
import {readFileSync} from 'node:fs'
import {LegacyVoiceJoin} from './helpers/reference-voice-join.js'
import {joinVoiceSentence} from '../../src/js/readers/voice-join.js'
import * as ui from '../../src/wasm/ui/inhouse_read_ui.js'
const fixture=vi.hoisted(()=>({ui:null}))
vi.mock('../../src/js/rust-ui.js',()=>({getRustUI:()=>fixture.ui}))
const core=ui.initSync({module:readFileSync('src/wasm/ui/inhouse_read_ui_bg.wasm')})
afterEach(()=>{fixture.ui=null})
const add=(a,b)=>a+b
function setup(native,trial){
 const host=new LegacyVoiceJoin(),events=[],source={physicalPage:2},oldSource={physicalPage:1},sentence={start:100,end:500},tailSentence={start:0,end:100}
 const endings=['incom-','incom‐','Text','字 📖','\ud800','x'.repeat(350),'Text.'],beginnings=['plete','Complete','αβγ','ªlower','𐐨text','\ud801','世界']
 const original={text:endings[trial%7],sentence:tailSentence,start:0,end:100,marks:trial%3?[{offset:0,source:oldSource,sentence:tailSentence}]:undefined,joinChecked:trial%11===0}
 const items=Array.from({length:trial%5+1},(_,i)=>({text:i===0?beginnings[trial%7]:'next '+i,start:100+i*10,end:110+i*10,sentence:i===3?{start:300,end:400}:sentence,marks:trial%2?[{offset:i,tag:'nested'}]:[]}))
 const plan={source,items};host.items=[{text:'Earlier'},original];host.chunks=host.items.map(item=>item.text);host.aheadPage=trial%13===0?null:{plan}
 host.needsPageJoin=(item,index)=>{events.push(['needs',item,index]);return trial%17!==0}
 host.pagePlanValid=value=>{events.push(['valid',value.source]);return trial%19!==0}
 host.join=()=>native?ui.voice_join_sentence(host,add):host.joinPageSentence()
 return {host,events,original,source,plan,sentence}
}
it('matches 500 physical-page sentence joins and preserves source identities',()=>{
for(let trial=0;trial<500;trial++){
 const results=[]
 for(const native of [false,true]){
  const {host,events,original,source,plan}=setup(native,trial);const initial=plan.items.slice();host.join()
  const joined=host.items.at(-1)
  if(joined!==original){assert.equal(joined.unjoined,original);assert.equal(joined.marks[original.marks?.length||0].source,source);for(const item of plan.items)assert.ok(initial.includes(item))}
  results.push({events,items:host.items,chunks:host.chunks,plan,original})
 }
 assert.deepEqual(results[1],results[0],'scenario '+trial)
}

})
it('copies symbols and own properties without changing prototypes or coercions',()=>{
const symbol=Symbol('mark')
for(const value of [0,1.5,undefined,'2',null,Symbol('offset')]){
 const results=[]
 for(const native of [false,true]){
  const {host,original,plan}=setup(native,1),mark={offset:value,[symbol]:'kept'}
  Object.defineProperty(mark,'__proto__',{value:{injected:true},enumerable:true})
  Object.defineProperty(mark,'hidden',{value:12,enumerable:false})
  Object.defineProperty(original,'__proto__',{value:{injected:true},enumerable:true})
  plan.items[0].marks=[mark]
  let error='';try{host.join()}catch(e){error=e.name}
  const joined=host.items.at(-1),nested=joined.marks?.at(-1)
  results.push({error,joined,proto:Object.getPrototypeOf(joined),symbol:nested?.[symbol],nestedProto:nested&&Object.getPrototypeOf(nested),hidden:nested?.hidden})
 }
 assert.deepEqual(results[1],results[0])
}

})
it('uses the exact Unicode lowercase category when joining hyphenated words',()=>{
 for(const ending of ['anti-','anti‐'])for(const beginning of ['lower','Upper','α','Α','𐐨','𐐀','ª','ʰ','字','\ud800','']){
  const results=[]
  for(const native of [false,true]){
   const {host,original,plan}=setup(native,1);original.text=ending;plan.items[0].text=beginning;plan.items=plan.items.slice(0,1)
   host.join();results.push({items:host.items,chunks:host.chunks,plan})
  }
  assert.deepEqual(results[1],results[0],JSON.stringify([ending,beginning]))
 }
})
it('keeps WASM memory bounded over repeated page joins',()=>{
for(let round=0;round<2;round++){
 const before=core.memory.buffer.byteLength
 for(let trial=0;trial<1000;trial++)setup(true,trial).host.join()
 if(round)assert.equal(core.memory.buffer.byteLength,before)
}

})

it('preserves astral and unpaired UTF-16 text offsets and the original tail for Pause',()=>{
 const {host,original,plan,source}=setup(true,1);original.text='😀\ud800';plan.items[0].text='𐐨 continuation';plan.items=plan.items.slice(0,1)
 host.join();const joined=host.items.at(-1)
 expect(joined.text).toBe('😀\ud800 𐐨 continuation')
 expect(joined.marks[original.marks.length].offset).toBe(4);expect(joined.marks[original.marks.length].source).toBe(source);expect(joined.unjoined).toBe(original)
})
it('propagates getter errors unchanged and releases failed-join allocations',()=>{
 const failure=Error('mark getter')
 for(let round=0;round<2;round++){
  const before=core.memory.buffer.byteLength
  for(let i=0;i<100;i++){
   const {host,original,plan}=setup(true,1);plan.items[0].marks=[{get offset(){throw failure}}]
   try{host.join();throw Error('Expected failure')}catch(error){expect(error).toBe(failure)}
   expect(host.items.at(-1)).toBe(original)
  }
  if(round)expect(core.memory.buffer.byteLength).toBe(before)
 }
})
it('adopts a late join implementation without replacing source records',()=>{
 const {host,original}=setup(false,1),native={voice_join_sentence:vi.fn(ui.voice_join_sentence)}
 fixture.ui=native;joinVoiceSentence(host);expect(native.voice_join_sentence).toHaveBeenCalledOnce();expect(host.items.at(-1).unjoined).toBe(original)
})
