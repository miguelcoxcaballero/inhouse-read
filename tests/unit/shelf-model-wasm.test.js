// @vitest-environment node
import { readFileSync } from 'node:fs';
import { beforeAll,describe,expect,it,vi } from 'vitest';
import { rustShelfModelLayout } from '../../src/js/shelf-model-layout-wasm.js';
import { SHELF_SPECS } from '../../src/js/shelf-types.js';
import { shelfModelLayout as reference } from './helpers/reference-shelf-model-layout.js';
let core;
beforeAll(async()=>{core=(await WebAssembly.instantiate(readFileSync('src/wasm/inhouse_read_core.wasm'))).instance.exports;});
function input(width=390,rows=7,count=40) {
 return {width,rows:Array.from({length:rows},()=>({})),sceneWidth:width,entries:Array.from({length:count},(_,i)=>({
  kind:['book','plant','lamp'][i%3],key:`item-${i}`,shelf:i%Math.max(1,rows),x:18+i*3.7,
  width:30+i*1.73,height:54+i*11.43,depth:44+i*.67,style:{heightRatio:.8+(i%20)/100},
  mount:i%2?'undershelf':'floor',node:{unchanged:i},book:{title:`Book ${i}`},rooftop:'preserved-on-lamps'
 }))};
}
const run=(value,type='baggebo',engine=core)=>rustShelfModelLayout(engine,value,SHELF_SPECS[type],type,240);
describe('compiled physical cabinet layout',()=>{
 for(const type of ['baggebo','walnut'])for(const width of [180,300,390,393.25,600,1280])for(const rows of [0,1,3,4,10])
 it(`matches every coordinate ${type}/${width}/${rows}`,()=>{
  const value=input(width,rows),before=structuredClone(value),actual=run(value,type);
  expect(actual).toEqual(reference(value,type));expect(value).toEqual(before);
  expect(rustShelfModelLayout(core,value,SHELF_SPECS[type],type,240,true)).toEqual(actual);
  for(let i=0;i<value.entries.length;i++){
   expect(actual.entries[i].node).toBe(value.entries[i].node);
   expect(actual.entries[i].book).toBe(value.entries[i].book);
   expect(actual.entries[i].style).toBe(value.entries[i].style);
  }
 });
 it('keeps empty cabinets, clamped bays and optional depths identical',()=>{
  expect(run(input(600,0,0))).toEqual(reference(input(600,0,0),'baggebo'));
  const value=input();value.entries[0].shelf=-2;value.entries[1].shelf=999;delete value.entries[1].depth;
  value.entries[3].shelf=null;delete value.entries[4].shelf;value.entries[4].depth=0;
  expect(run(value)).toEqual(reference(value,'baggebo'));
 });
 it('uses the original path for accessors without reading them twice',()=>{
  const value=input(),getter=vi.fn(()=>390);Object.defineProperty(value,'width',{get:getter});
  expect(run(value)).toBeNull();expect(getter).not.toHaveBeenCalled();
  const nested=input();Object.defineProperty(nested.entries[0].style,'heightRatio',{get:getter});
  expect(run(nested)).toBeNull();expect(getter).not.toHaveBeenCalled();
 });
 it('rejects overflow in Rust and leaves no partially valid layout',()=>{
  const value=input(1e308);expect(run(value)).toBeNull();
  const corrupt=input();corrupt.entries[0].height=NaN;
  expect(rustShelfModelLayout(core,corrupt,SHELF_SPECS.baggebo,'baggebo',240,true)).toBeNull();
 });
 it.each([null,{}, {shelf_model(){return 0;}}])('declines unavailable engines',engine=>expect(run(input(),'baggebo',engine)).toBeNull());
 it.each([NaN,Infinity,0,-4,'600'])('declines invalid width %s',width=>expect(run(input(width))).toBeNull());
 it.each([()=>0,()=>{throw Error('allocation');}])('does not release a failed allocation',alloc=>{
  const free=vi.fn();expect(run(input(),'baggebo',{...core,alloc_f64:alloc,free_f64:free})).toBeNull();expect(free).not.toHaveBeenCalled();
 });
 it.each([()=>0,()=>{throw Error('kernel');}])('releases a rejected kernel',kernel=>{
  const free=vi.fn(core.free_f64);expect(run(input(),'baggebo',{...core,shelf_model:kernel,free_f64:free})).toBeNull();expect(free).toHaveBeenCalledOnce();
 });
 it('refreshes views after memory growth and releases every arena',()=>{
  let live=0;const engine={...core,alloc_f64(n){live+=n;return core.alloc_f64(n);},free_f64(p,n){live-=n;core.free_f64(p,n);},
   shelf_model(...args){core.memory.grow(1);return core.shelf_model(...args);}};
  const value=input(393.25),actual=run(value,'walnut',engine);expect(actual).toEqual(reference(value,'walnut'));expect(live).toBe(0);
  run(input(600,10,300));expect(actual).toEqual(reference(value,'walnut'));
 });
});
