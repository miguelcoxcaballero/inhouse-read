import {beforeAll,afterEach,it,expect,vi} from 'vitest'
import {readFileSync} from 'node:fs'
import * as ui from '../../src/wasm/ui/inhouse_read_ui.js'
import {isBookmarked,toggleBookmark,prependHistory,isBookmarkedLegacy,toggleBookmarkLegacy} from '../../src/js/readers/reading-places.js'
const runtime=vi.hoisted(()=>({ui:null}))
vi.mock('../../src/js/rust-ui.js',()=>({getRustUI:()=>runtime.ui}))
let core
beforeAll(()=>{core=ui.initSync({module:readFileSync('src/wasm/ui/inhouse_read_ui_bg.wasm')});runtime.ui=ui})
afterEach(()=>{runtime.ui=ui})
it('matches 2000 bookmark/history operations with the same record references and array mutations',()=>{
 let seed=819;const rnd=n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n}
 for(let i=0;i<2000;i++){
  const records=Array.from({length:rnd(130)},(_,n)=>({fraction:rnd(12)/10,locator:rnd(2)?{kind:'pdf-page',value:rnd(10)+1,textOffset:rnd(5)}:{kind:'cfi',value:'epubcfi('+rnd(10)+')'},label:'Original '+n}))
  const location=records.length&&i%3===0?records[rnd(records.length)]:{fraction:.5,locator:{kind:'cfi',value:'new'}}
  expect(isBookmarked(records,location)).toBe(isBookmarkedLegacy(records,location))
  let a=0,b=0;const place={...location,label:'New'},left=[...records],right=[...records]
  const expected=toggleBookmarkLegacy(left,location,()=>{a++;return place}),actual=toggleBookmark(right,location,()=>{b++;return place})
  expect(actual).toEqual(expected);expect(right).toEqual(left);expect(a).toBe(b)
  for(let j=0;j<actual.length;j++)expect(actual[j]).toBe(expected[j])
  const history=prependHistory(records,place),old=[place,...records].slice(0,20)
  expect(history).toEqual(old);for(let j=0;j<history.length;j++)expect(history[j]).toBe(old[j])
 }
},15000)
it('preserves fraction tolerance, JSON property order and all duplicate removals',()=>{
 for(const delta of [0,.00009,.0001,.00011,-.0001]){const records=[{locator:null,fraction:.5+delta}];expect(isBookmarked(records,{locator:null,fraction:.5})).toBe(isBookmarkedLegacy(records,{locator:null,fraction:.5}))}
 const a={fraction:.5,locator:{kind:'pdf-page',value:3}},b={fraction:.5,locator:{value:3,kind:'pdf-page'}}
 expect(isBookmarked([a],b)).toBe(false)
 const create=vi.fn();expect(toggleBookmark([a,a,b,a],a,create)).toEqual([b]);expect(create).not.toHaveBeenCalled()
})
it('serializes the requested locator once and propagates errors without retaining state',()=>{
 let requests=0;const location={fraction:.5,locator:{toJSON(){requests++;return {kind:'cfi',value:'x'}}}}
 expect(isBookmarked(Array.from({length:100},(_,i)=>({fraction:i/100,locator:{kind:'cfi',value:String(i)}})),location)).toBe(false)
 expect(requests).toBe(1)
 const original=[];expect(()=>toggleBookmark(original,location,()=>{throw Error('cancelled')})).toThrow('cancelled');expect(original).toEqual([])
 const circular={};circular.self=circular
 expect(()=>isBookmarked([{fraction:0,locator:circular}],{fraction:0,locator:null})).toThrow()
 expect(isBookmarked([{fraction:0,locator:null}],{fraction:0,locator:null})).toBe(true)
})
it('keeps memory bounded and retains the original fallback when Rust is absent',()=>{
 const before=core.memory.buffer.byteLength
 for(let i=0;i<1000;i++){isBookmarked([{fraction:0,locator:null}],{fraction:1,locator:null});toggleBookmark([],{fraction:1,locator:null},()=>({fraction:1,locator:null}))}
 expect(core.memory.buffer.byteLength).toBe(before)
 runtime.ui=null;const location={fraction:0,locator:null},create=()=>location
 expect(toggleBookmark([],location,create)).toEqual([location]);expect(isBookmarked([location],location)).toBe(true)
 expect(prependHistory([],location)).toEqual([location])
})
