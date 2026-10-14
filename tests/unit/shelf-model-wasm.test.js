// @vitest-environment node
import { readFileSync } from 'node:fs';
import { beforeAll,describe,expect,it,vi } from 'vitest';
import { rustShelfModelLayout } from '../../src/js/shelf-model-layout-wasm.js';
import { SHELF_SPECS } from '../../src/js/shelf-types.js';
import { shelfModelLayout as reference } from './helpers/reference-shelf-model-layout.js';
import { prng } from './helpers/pointer-harness.js';
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
const outcome=work=>{try{return {value:work()};}catch(error){return {threw:`${error?.name}: ${error?.message}`};}};
describe('compiled physical cabinet layout',()=>{
 for(const type of ['baggebo','walnut'])for(const width of [180,300,390,393.25,600,1280])for(const rows of [0,1,3,4,10])
 it(`matches every coordinate ${type}/${width}/${rows}`,()=>{
  const value=input(width,rows),before=structuredClone(value),actual=run(value,type);
  expect(actual).toEqual(reference(value,type));expect(value).toEqual(before);
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
 it('reads accessor-backed measurements once and lays them out like plain numbers',()=>{
  // The JavaScript original read a measurement several times; the core takes one snapshot.
  const value=input(),getter=vi.fn(()=>390);Object.defineProperty(value,'width',{get:getter});
  expect(run(value)).toEqual(reference(input(),'baggebo'));expect(getter).toHaveBeenCalled();
  const nested=input(),ratio=vi.fn(()=>.9);
  Object.defineProperty(nested.entries[0].style,'heightRatio',{get:ratio,enumerable:true});
  const actual=run(nested);expect(ratio).toHaveBeenCalledTimes(1);
  expect(actual).toEqual(reference(nested,'baggebo'));
 });
 it('lays out overflowing and non-finite measurements exactly like the original arithmetic',()=>{
  for(const width of [1e308,1e-320,-1e308]){const value=input(width);expect(run(value)).toEqual(reference(value,'baggebo'));}
  const corrupt=input();corrupt.entries[0].height=NaN;expect(run(corrupt)).toEqual(reference(corrupt,'baggebo'));
 });
 it('matches the original for 6000 degenerate cabinets (zero, negative, NaN and infinite measurements)',()=>{
  // A hidden or collapsed shelf measures to zero sizes; the original never rejected any of it.
  const widths=[0,-0,-4,NaN,Infinity,-Infinity,1e-300,1e300,100.5,390,600,1280,393.25];
  const sizes=[0,-0,1,-1,1e-9,12.5,54,100,172,1e6,NaN,Infinity,-Infinity,1e308,-5,.5];
  const bays=[undefined,null,0,1,2,3,5,-1,999,Infinity,-Infinity,'2',-0,3,1],invalidBays=[1.5,NaN,'x',.25];
  let threw=0,finite=0,nonFinite=0,types=new Set();
  for(let seed=1;seed<=6000;seed++){
   const r=prng(seed*104729),stray=r.chance(.15);
   const value={width:r.pick(widths),rows:Array.from({length:r.int(0,10)},()=>({})),entries:Array.from({length:r.int(0,14)},(_,i)=>({
    kind:r.pick(['book','plant','lamp','book','plant',undefined]),key:`k${i}`,shelf:stray&&r.chance(.3)?r.pick(invalidBays):r.pick(bays),x:r.pick(sizes),
    width:r.pick(sizes),height:r.pick(sizes),...(r.chance(.8)?{depth:r.pick(sizes)}:{}),style:{heightRatio:r.pick([...sizes,.8,1])},
    mount:r.pick(['floor','undershelf',undefined]),node:{i}}))};
   const type=r.pick(['baggebo','walnut']);types.add(type);
   const expected=outcome(()=>reference(value,type)),actual=outcome(()=>run(value,type));
   expect(actual,`seed ${seed}`).toEqual(expected);
   if(expected.threw)threw++;else if(expected.value.entries.every(e=>Number.isFinite(e.x)&&Number.isFinite(e.y)&&Number.isFinite(e.width)))finite++;else nonFinite++;
  }
  // The corpus must reach the invalid-bay error, ordinary layouts and NaN/Infinity results.
  expect(threw).toBeGreaterThan(500);expect(finite).toBeGreaterThan(200);expect(nonFinite).toBeGreaterThan(1000);
 });
 it('refuses a numeric width that is not a number and entries it cannot place without throwing',()=>{
  expect(run(input('600'))).toBeNull();
  const value=input();value.entries[2].x='12';expect(run(value)).toBeNull();
  const noStyle=input();noStyle.entries[0].kind='book';delete noStyle.entries[0].style;
  expect(outcome(()=>run(noStyle))).toEqual(outcome(()=>reference(noStyle,'baggebo')));
 });
 it.each([null,{}, {shelf_model(){return 0;}}])('declines unavailable engines',engine=>expect(run(input(),'baggebo',engine)).toBeNull());
 it.each([NaN,Infinity,0,-4])('lays out a degenerate width %s like the original',width=>{const value=input(width);expect(run(value)).toEqual(reference(value,'baggebo'));});
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
