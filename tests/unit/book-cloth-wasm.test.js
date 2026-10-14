// @vitest-environment node
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {beforeAll,afterEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({core:null}));
vi.mock('../../src/js/rust-core.js',()=>({getRustCore:()=>state.core,loadRustCore:async()=>state.core??(await globalThis.__inhouseRustReady).exports}));
import {paintCloth,seededRandom} from '../../src/js/spine-surface.js';
import {rustBookClothPlan} from '../../src/js/book-surface-wasm.js';
import {paintCloth as reference,seededRandom as referenceRandom} from './helpers/reference-book-cloth.js';
let core;
beforeAll(async()=>{core=(await WebAssembly.instantiate(readFileSync('src/wasm/inhouse_read_core.wasm'))).instance.exports;expect(typeof core.book_cloth_plan).toBe('function');state.core=core;});
afterEach(()=>{state.core=core;vi.unstubAllGlobals();});
function record(painter,random,width,options={},pixels=true){
 const calls=[];
 vi.stubGlobal('document',{createElement:()=>{const field={width:0,height:0,pixels:null};const f={putImageData:image=>{field.pixels=image.data.slice();}};if(pixels)f.createImageData=(w,h)=>({data:new Uint8ClampedArray(w*h*4)});field.getContext=()=>f;return field;}});
 const c=new Proxy({save:()=>calls.push(['save']),restore:()=>calls.push(['restore']),fillRect:(...args)=>calls.push(['rect',...args]),drawImage:(field,...args)=>calls.push(['image',field.width,field.height,field.pixels,...args])},{set(target,key,value){calls.push([key,value]);target[key]=value;return true;}});
 painter(c,width,random,options);return {calls,tail:Array.from({length:100},()=>random())};
}
for(const width of [0,80,136,257.3592701820759,512,8192])for(const metal of [false,true])it(`keeps every paint command, field byte and next PRNG value at width ${width}, metal ${metal}`,()=>{
 const call=vi.fn(core.book_cloth_plan);state.core={...core,book_cloth_plan:call};const a=record(paintCloth,seededRandom(17),width,{metal}),b=record(reference,referenceRandom(17),width,{metal});assert.deepEqual(a,b);expect(call).toHaveBeenCalledOnce();
});
it('retains random state across mixed calls, zero state and repeated cloth passes',()=>{
 for(const seed of [0,1,-1,0x92d4860b,0xffffffff]){
  const a=seededRandom(seed),b=referenceRandom(seed);for(let i=0;i<1;i++)expect(a()).toBe(b());
  for(const metal of [false,true,false])assert.deepEqual(record(paintCloth,a,257.35,{metal}),record(reference,b,257.35,{metal}));
 }
});
it('leaves thumbnail calls and arbitrary random callbacks on the unchanged path',()=>{
 const call=vi.fn(core.book_cloth_plan);state.core={...core,book_cloth_plan:call};
 assert.deepEqual(record(paintCloth,seededRandom(15),180,{threads:false}),record(reference,referenceRandom(15),180,{threads:false}));
 assert.deepEqual(record(paintCloth,()=>.42,180),record(reference,()=>.42,180));expect(call).not.toHaveBeenCalled();
});
it('matches contexts without ImageData and the unsupported-dimension fallback',()=>{
 assert.deepEqual(record(paintCloth,seededRandom(9),180,{},false),record(reference,referenceRandom(9),180,{},false));
 assert.deepEqual(record(paintCloth,seededRandom(9),-80),record(reference,referenceRandom(9),-80));
});
it('does not consume random state on native allocation, rejection or trap failures',()=>{
 for(const engine of [null,{}, {...core,alloc_f64:()=>0},{...core,book_cloth_plan:()=>0},{...core,book_cloth_plan:()=>{throw Error('trap');}}]){
  state.core=engine;assert.deepEqual(record(paintCloth,seededRandom(17),180),record(reference,referenceRandom(17),180));
 }
});
it('owns outputs after freeing scratch and growing memory; invalid input never allocates',()=>{
 const free=vi.fn(core.free_f64),out=rustBookClothPlan({...core,free_f64:free},17,180,false);expect(free).toHaveBeenCalledOnce();const expected={...out,pixels:out.pixels.slice(),commands:out.commands.slice()};core.memory.grow(1);rustBookClothPlan(core,99,512,true);assert.deepEqual(out,expected);
 const alloc=vi.fn(core.alloc_f64),engine={...core,alloc_f64:alloc};for(const width of [NaN,Infinity,-1,8193,'180'])expect(rustBookClothPlan(engine,17,width,false)).toBeNull();expect(alloc).not.toHaveBeenCalled();
});
