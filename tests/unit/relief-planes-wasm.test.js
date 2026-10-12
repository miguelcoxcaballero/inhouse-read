// @vitest-environment node
import {readFileSync} from 'node:fs';
import {beforeAll,afterEach,expect,it,vi} from 'vitest';
import {wasmReliefRgbaPlanes} from '../../src/js/cover-relief-wasm.js';
const state=vi.hoisted(()=>({core:null}));
vi.mock('../../src/js/rust-core.js',()=>({getRustCore:()=>state.core,loadRustCore:async()=>state.core}));
import {reliefPlanesToRgba} from '../../src/js/cover-relief.js';
let core;
afterEach(()=>{state.core=core;});
beforeAll(async()=>{core=(await WebAssembly.instantiate(readFileSync('src/wasm/inhouse_read_core.wasm'))).instance.exports;expect(typeof core.relief_rgba_planes).toBe('function');});
function fixture(width,height){
 const n=width*height;return {width,height,heightMap:Uint8Array.from({length:n},(_,i)=>i%256),foil:Uint8Array.from({length:n},(_,i)=>(i*13+77)%256),gloss:Uint8Array.from({length:n},(_,i)=>(i*89+253)%256)};
}
function exact(out,maps){
 expect(out).not.toBeNull();
 for(const [key,source] of [['height',maps.heightMap],['foil',maps.foil],['gloss',maps.gloss]]){
  expect(out[key]).toBeInstanceOf(Uint8ClampedArray);expect(out[key].length).toBe(source.length*4);
  for(let i=0;i<source.length;i++)for(let channel=0;channel<4;channel++)if(out[key][i*4+channel] !== (channel===3?255:source[i]))throw Error(key+' pixel '+i+' channel '+channel);
 }
}
for(const [w,h] of [[1,1],[3,5],[17,31],[128,128],[288,384],[512,512],[1024,1024]])it(`preserves all three planes ${w}x${h}`,()=>{
 const maps=fixture(w,h),source=maps.heightMap.slice(),call=vi.fn(core.relief_rgba_planes),free=vi.fn(core.free_f64);
 const out=wasmReliefRgbaPlanes({...core,relief_rgba_planes:call,free_f64:free},maps);
 exact(out,maps);expect(call).toHaveBeenCalledOnce();expect(free).toHaveBeenCalledOnce();for(let i=0;i<source.length;i++)if(maps.heightMap[i]!==source[i])throw Error("Input modified at "+i);
});
it('owns independent plane buffers after freeing scratch and growing memory',()=>{
 const maps=fixture(19,17),out=wasmReliefRgbaPlanes(core,maps);core.memory.grow(1);wasmReliefRgbaPlanes(core,fixture(512,512));exact(out,maps);
 expect(out.height.buffer===out.foil.buffer).toBe(false);expect(out.foil.buffer===out.gloss.buffer).toBe(false);expect(out.height.buffer===core.memory.buffer).toBe(false);
});
it('rejects malformed planes and unavailable kernels before allocating',()=>{
 const alloc=vi.fn(core.alloc_f64),engine={...core,alloc_f64:alloc},maps=fixture(17,19);
 for(const bad of [{...maps,width:0},{...maps,height:1.5},{...maps,width:2048,height:2048},{...maps,foil:new Uint8Array(1)},{...maps,gloss:[]}])expect(wasmReliefRgbaPlanes(engine,bad)).toBeNull();
 expect(wasmReliefRgbaPlanes(null,maps)).toBeNull();expect(wasmReliefRgbaPlanes({},maps)).toBeNull();expect(alloc).not.toHaveBeenCalled();
});
it('frees rejected or trapped kernels and handles allocation failure',()=>{
 const maps=fixture(17,19),free=vi.fn(core.free_f64);
 for(const fn of [()=>0,()=>{throw Error('trap');}]){free.mockClear();expect(wasmReliefRgbaPlanes({...core,relief_rgba_planes:fn,free_f64:free},maps)).toBeNull();expect(free).toHaveBeenCalledOnce();}
 free.mockClear();expect(wasmReliefRgbaPlanes({...core,alloc_f64:()=>0,free_f64:free},maps)).toBeNull();expect(free).not.toHaveBeenCalled();
});

it('uses one native call for production-sized maps and preserves the startup fallback',()=>{
 const maps=fixture(64,64),call=vi.fn(core.relief_rgba_planes);state.core={...core,relief_rgba_planes:call};exact(reliefPlanesToRgba(maps),maps);expect(call).toHaveBeenCalledOnce();
 call.mockClear();const small=fixture(17,19);exact(reliefPlanesToRgba(small),small);expect(call).not.toHaveBeenCalled();
 for(const engine of [null,{...core,relief_rgba_planes:()=>0}]){state.core=engine;exact(reliefPlanesToRgba(maps),maps);}
});
