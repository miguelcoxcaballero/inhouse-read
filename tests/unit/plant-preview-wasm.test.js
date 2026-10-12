// @vitest-environment node
import {readFileSync} from 'node:fs';
import {beforeAll,expect,it,vi} from 'vitest';
import {rustPlantPreview} from '../../src/js/plant-preview-wasm.js';
import {plantPreview as reference} from './helpers/reference-plant-preview.js';
let core;
beforeAll(async()=>{core=(await WebAssembly.instantiate(readFileSync('src/wasm/inhouse_read_core.wasm'))).instance.exports;});
const fixture=(w,h)=>{
 let seed=63891;const cols=Math.ceil(w/8)+1,rows=Math.ceil(h/8)+1;
 const lattice=Float32Array.from({length:cols*rows*5},()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296*1.4-.2;});
 return [w,h,cols,rows,lattice,new Uint8Array(w*h*4),new Uint8Array(w*h*4)];
};
for(const [w,h] of [[1,1],[7,3],[8,8],[9,9],[17,19],[32,256],[128,128],[128,256],[256,256],[256,512],[512,512]])it(`preserves every texture byte ${w}×${h}`,()=>{
 const args=fixture(w,h),lattice=args[4].slice(),expected=reference(w,h,lattice);
 expect(rustPlantPreview(core,...args)).toBe(true);
 expect(Buffer.from(args[5]).equals(Buffer.from(expected.pigment))).toBe(true);
 expect(Buffer.from(args[6]).equals(Buffer.from(expected.data))).toBe(true);expect(args[4]).toEqual(lattice);
});
it('keeps clamping, halfway rounding and material blue/alpha channels',()=>{
 const args=fixture(17,19);for(const value of [-1,0,.5,1,2,127.5/255]){
  args[4].fill(value);args[5].fill(27);args[6].fill(93);const expected=reference(17,19,args[4]);
  expect(rustPlantPreview(core,...args)).toBe(true);expect(args[5]).toEqual(expected.pigment);expect(args[6]).toEqual(expected.data);
 }
});
it('rejects malformed shapes without touching existing texture bytes',()=>{
 const args=fixture(9,9),alloc=vi.fn(),engine={...core,alloc_f64:alloc};
 for(const [i,value] of [[0,0],[0,NaN],[1,2049],[2,9],[3,4],[4,new Float32Array(1)],[5,new Uint8Array(1)]]){
  const input=[...args];input[i]=value;expect(rustPlantPreview(engine,...input)).toBe(false);
 }
 expect(alloc).not.toHaveBeenCalled();
 args[4][5]=NaN;args[5].fill(42);expect(rustPlantPreview(core,...args)).toBe(false);expect(args[5].every(v=>v===42)).toBe(true);
});
it('copies out after memory growth and releases the arena',()=>{
 const args=fixture(128,256),expected=reference(128,256,args[4]),free=vi.fn(core.free_f64);
 const engine={...core,free_f64:free,plant_surface_preview(...input){core.memory.grow(1);return core.plant_surface_preview(...input);}};
 expect(rustPlantPreview(engine,...args)).toBe(true);expect(free).toHaveBeenCalledOnce();
 expect(Buffer.from(args[5]).equals(Buffer.from(expected.pigment))).toBe(true);expect(Buffer.from(args[6]).equals(Buffer.from(expected.data))).toBe(true);
});
it.each([()=>0,()=>{throw Error('kernel');}])('releases rejected kernels',kernel=>{
 const free=vi.fn(core.free_f64);expect(rustPlantPreview({...core,free_f64:free,plant_surface_preview:kernel},...fixture(8,8))).toBe(false);expect(free).toHaveBeenCalledOnce();
});
