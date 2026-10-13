import {beforeAll,beforeEach,it,expect,vi} from 'vitest'
import {readFileSync} from 'node:fs'
import * as ui from '../../src/wasm/ui/inhouse_read_ui.js'
import {speechPageBreaks} from '../../src/js/readers/speech-page-breaks.js'
import {speechPageBreaks as reference} from './helpers/reference-speech-page-breaks.js'
import {layout} from '../helpers/speech-page-layout.js'
const runtime=vi.hoisted(()=>({ui:null,yielded:()=>{}}))
vi.mock('../../src/js/rust-ui.js',()=>({getRustUI:()=>runtime.ui}))
vi.mock('../../src/js/readers/neural-voice/task-yield.js',()=>({yieldToMessages:()=>{runtime.yielded();return Promise.resolve()}}))
let core
beforeAll(()=>{core=ui.initSync({module:readFileSync('src/wasm/ui/inhouse_read_ui_bg.wasm')});runtime.ui=ui})
beforeEach(()=>{runtime.yielded=()=>{}})
const renderer={size:100,pages:100,scrolled:false}
it('matches 500 complete glyph-query sequences, page cuts and cancellation checks',async()=>{
 let seed=4728;const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2**32)
 for(let i=0;i<500;i++){
  const text=('abcd😀x y\n z\t日本語é\ufeff\udc00').repeat(2+i%25),cuts=[...new Set(Array.from({length:i%12},()=>1+Math.floor(random()*(text.length-1))))].sort((a,b)=>a-b)
  const spanSize=i%2?5:50,spans=[];for(let start=0;start<text.length;start+=spanSize)spans.push([start,Math.min(text.length,start+spanSize)])
  const config={rtl:i%3===1,vertical:i%3===2,empty:i%47===0,spans},left=layout(text,cuts,config),right=layout(text,cuts,config)
  let before=0,after=0;const stop=i%7===0?3:Infinity
  const expected=await reference(left,renderer,{isCurrent:()=>++before<stop}),actual=await speechPageBreaks(right,renderer,{isCurrent:()=>++after<stop})
  expect(actual).toEqual(expected);expect(right.calls).toEqual(left.calls);expect(after).toBe(before)
 }
},15000)
it('preserves invalid, scrolling and nonfinite renderer handling without measuring glyphs',async()=>{
 for(const render of [{},{...renderer,scrolled:true},{...renderer,size:Infinity},{...renderer,size:0},{...renderer,pages:undefined}])for(const rtl of [false,true]){
  const left=layout('abc def',[3],{rtl}),right=layout('abc def',[3],{rtl})
  expect(await speechPageBreaks(right,render)).toEqual(await reference(left,render));expect(right.calls).toEqual(left.calls)
 }
})
it('yields after exactly 64 spans and discards cuts when the document closes during that task',async()=>{
 const text='a'.repeat(200),map=layout(text,[50,100],{spans:Array.from({length:200},(_,i)=>[i,i+1])}),points=[]
 runtime.yielded=()=>points.push(map.calls.length)
 expect(await speechPageBreaks(map,renderer)).toEqual([50,100]);expect(points).toEqual([64,128,192])
 map.calls=[];let live=true;runtime.yielded=()=>{live=false}
 expect(await speechPageBreaks(map,renderer,{isCurrent:()=>live})).toEqual([]);expect(map.calls).toHaveLength(64)
})
it('releases a scanner after a range exception and can scan the next document',async()=>{
 const map=layout('abc',[1]),failure=new Error('Range document replaced');map.rangeFor=()=>{throw failure}
 await expect(speechPageBreaks(map,renderer)).rejects.toBe(failure)
 expect(await speechPageBreaks(layout('abcdef',[2,4]),renderer)).toEqual([2,4])
})
it('bounds memory across 1000 scanners and frees all document references after completion',async()=>{
 const map=layout('abcd😀 ghij'.repeat(20),[30,80,150])
 for(let i=0;i<30;i++){map.calls=[];await speechPageBreaks(map,renderer)}const memory=core.memory.buffer.byteLength
 for(let i=0;i<1000;i++){map.calls=[];await speechPageBreaks(map,renderer)}
 expect(core.memory.buffer.byteLength).toBe(memory)
},15000)
