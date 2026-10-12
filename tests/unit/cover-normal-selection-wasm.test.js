// @vitest-environment node
import { beforeAll, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import * as rustLoader from '../../src/js/rust-core.js';
import { loadRustCore } from '../../src/js/rust-core.js';
import { heightToNormals } from '../../src/js/cover-relief.js';
import { wasmHeightToNormals } from '../../src/js/cover-relief-wasm.js';
import { mapsFor, referenceNormals } from '../helpers/cover-relief-reference.mjs';
const drain = task => { let step; do { step=task.next(); } while(!step.done); return step.value; };
const equal = (actual, expected) => expect(Buffer.compare(Buffer.from(actual),Buffer.from(expected))).toBe(0);
function selected(maps,gain=1) {
  const result=referenceNormals(maps,gain);
  for(let i=0;i<maps.width*maps.height;i++) result[i*4+3]=maps.mask?.[i]??Math.max(maps.gloss[i],maps.foil[i],maps.heightMap[i]);
  return result;
}
let core;
beforeAll(async()=>{
 core=await loadRustCore({bytes:await readFile(new URL('../../src/wasm/inhouse_read_core.wasm',import.meta.url))});
 expect(typeof core.relief_normal_selected_rows).toBe('function');
});
for(const [width,height] of [[1,1],[1,35],[47,1],[17,31],[128,193],[256,256],[512,512]])
 it(`packs selection without changing any normal bytes at ${width}x${height}`,()=>{
  for(const withOwners of [false,true]) for(const withMask of [false,true]) {
   const maps=mapsFor(width,height,79,withOwners);
   if(!withMask){delete maps.mask;maps.preserveInk=false;}else maps.mask=Uint8Array.from(maps.mask,(_,i)=>(i*17)%256);
   const originals=structuredClone(maps);
   for(const gain of [0,.03,1,3.7]) {
    const unit=.6/255/(2*(200/Math.max(width,height)))*gain;
    const expected=selected(maps,gain);
    equal(drain(wasmHeightToNormals(core,maps,unit,{selectionAlpha:true})),expected);
    equal(drain(heightToNormals(maps,{gain,selectionAlpha:true})),expected);
   }
   for(const key of ['heightMap','mask','owners','gloss','foil'])if(maps[key])equal(maps[key],originals[key]);
  }
 });
it('recreates views on memory growth and owns its completed output',()=>{
 const maps=mapsFor(64,65),unit=.6/255/(2*(200/65));
 const task=wasmHeightToNormals(core,maps,unit,{selectionAlpha:true});expect(task.next().done).toBe(false);
 core.memory.grow(1);const actual=drain(task);equal(actual,selected(maps));
 drain(wasmHeightToNormals(core,mapsFor(64,65,23),unit,{selectionAlpha:true}));equal(actual,selected(maps));
});
it('frees cancelled and rejected selected-normal allocations',()=>{
 const maps=mapsFor(128,129);
 for(const reject of [false,true]) {
  const tracked={...core,alloc_f64:vi.fn(core.alloc_f64),free_f64:vi.fn(core.free_f64)};
  if(reject)tracked.relief_normal_selected_rows=()=>0;
  const task=wasmHeightToNormals(tracked,maps,.003,{selectionAlpha:true});
  if(reject)expect(()=>task.next()).toThrow('rechazó');else{expect(task.next().done).toBe(false);task.return();}
  expect(tracked.free_f64).toHaveBeenCalledExactlyOnceWith(tracked.alloc_f64.mock.results[0].value,tracked.alloc_f64.mock.calls[0][0]);
 }
});
it('rejects unavailable or invalid selection inputs without allocating',()=>{
 const maps=mapsFor(32,32),tracked={...core,alloc_f64:vi.fn(core.alloc_f64)};
 for(const [candidate,data] of [[{...tracked,relief_normal_selected_rows:undefined},maps],
 [tracked,{...maps,mask:new Uint8Array(1)}],[tracked,{...maps,mask:null,preserveInk:false,gloss:null}],
 [tracked,{...maps,mask:null,preserveInk:true}],[tracked,{...maps,width:0}]]) {
  expect(drain(wasmHeightToNormals(candidate,data,.003,{selectionAlpha:true}))).toBeNull();
 }
 expect(tracked.alloc_f64).not.toHaveBeenCalled();
});

it('retains selected alpha and normals in the JavaScript recovery path',()=>{
 const stub=vi.spyOn(rustLoader,'getRustCore').mockReturnValue(null);
 try{for(const withMask of [false,true]){const maps=mapsFor(37,43);if(!withMask){delete maps.mask;maps.preserveInk=false;}
 equal(drain(heightToNormals(maps,{selectionAlpha:true})),selected(maps));}}
 finally{stub.mockRestore();}
});
