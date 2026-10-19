// @vitest-environment node
import {beforeAll, expect, it, vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {wasmRenderRelief,wasmHeightToNormals,wasmComposeReliefLayers,wasmReliefRgbaPlanes} from '../../src/js/cover-relief-wasm.js';
import {referenceNormals,referenceCompose,mapsFor,layers} from '../helpers/cover-relief-reference.mjs';
let core;
beforeAll(async()=>{core=(await WebAssembly.instantiate(readFileSync('src/wasm/inhouse_read_core.wasm'))).instance.exports;expect(typeof core.relief_render_new).toBe('function');});
function drain(task){let yields=0;for(;;){const step=task.next();if(step.done)return{value:step.value,yields};yields++;}}
const bytes=(a,b)=>{expect(a.constructor).toBe(b.constructor);expect(Buffer.from(a.buffer,a.byteOffset,a.byteLength).equals(Buffer.from(b.buffer,b.byteOffset,b.byteLength))).toBe(true);};
const unit=maps=>.6/255/(2*(200/Math.max(maps.width,maps.height)));
function normalReference(maps,selected){const normal=referenceNormals(maps);if(selected)for(let i=0;i<maps.width*maps.height;i++)normal[i*4+3]=maps.mask?maps.mask[i]:Math.max(maps.heightMap[i],maps.foil[i],maps.gloss[i]);return normal;}
function rgbaReference(source){const out=new Uint8ClampedArray(source.length*4);for(let i=0;i<source.length;i++)out.set([source[i],source[i],source[i],255],i*4);return out;}
for(const [w,h]of [[1,1],[3,5],[7,16],[7,17],[193,128],[512,512]])it(`keeps final normal/RGBA bytes and normal safe points at ${w}x${h}`,()=>{
 for(const owners of [false,true])for(const preserve of [false,true])for(const selected of [false,true]){
  const maps=mapsFor(w,h,19,owners);maps.preserveInk=preserve;
  if(!preserve && !owners)delete maps.mask;
  const actual=drain(wasmRenderRelief(core,maps,unit(maps),{rgba:true,selectionAlpha:selected}));
  expect(actual.yields).toBe(Math.floor(h/16));expect(actual.value.pixels).toBe(maps);
  bytes(actual.value.normal,normalReference(maps,selected));
  for(const [key,plane]of [['height',maps.heightMap],['foil',maps.foil],['gloss',maps.gloss]])bytes(actual.value[key],rgbaReference(plane));
 }
});
it('composes all layer strengths and normals without an intermediate host roundtrip',()=>{
 const maps=mapsFor(193,129,19,true),before=[maps.owners.slice(),maps.baseMask.slice(),maps.baseHeight.slice()];
 for(const strength of [0,.01,.25,.5,.75,1])for(const selected of [false,true]){
  const chosen=layers.map((layer,i)=>({...layer,strength:i%2?strength:1-strength})),expected=referenceCompose(maps,chosen);
  const actual=drain(wasmRenderRelief(core,maps,unit(maps),{layers:chosen,selectionAlpha:selected}));
  expect(actual.yields).toBe(Math.floor(maps.width*maps.height/1024)+Math.floor(maps.height/16));
  bytes(actual.value.normal,normalReference(expected,selected));
  for(const plane of ['heightMap','mask','gloss','foil'])bytes(actual.value.pixels[plane],expected[plane]);
  expect(actual.value.pixels.layers).toEqual(chosen);
 }
 [maps.owners,maps.baseMask,maps.baseHeight].forEach((array,i)=>bytes(array,before[i]));
});
it('retains independently owned outputs across repeated bakes, interleaving and memory growth',()=>{
 const maps=[mapsFor(129,65,23,true),mapsFor(63,97,101,true)],tasks=maps.map(m=>wasmRenderRelief(core,m,unit(m),{layers,rgba:true,selectionAlpha:true})),out=[null,null];
 while(out.some(v=>v===null))for(let i=0;i<2;i++)if(out[i]===null){const step=tasks[i].next();if(step.done)out[i]=step.value;else core.memory.grow(1);}
 for(let i=0;i<2;i++){
  const expected=referenceCompose(maps[i],layers);bytes(out[i].normal,normalReference(expected,true));
  for(const [key,source]of [['height',expected.heightMap],['foil',expected.foil],['gloss',expected.gloss]])bytes(out[i][key],rgbaReference(source));
  const buffers=['normal','height','foil','gloss'].map(key=>out[i][key].buffer);expect(new Set(buffers).size).toBe(4);expect(buffers.includes(core.memory.buffer)).toBe(false);
 }
 const original=out[0].normal.slice();drain(wasmRenderRelief(core,maps[1],unit(maps[1]),{rgba:true}));bytes(out[0].normal,original);
});
it('frees every partial stage on cancellation, including fully composed maps before normals finish',()=>{
 const maps=mapsFor(64,65,1,true);
 for(const options of [{rgba:true},{layers,rgba:true}])for(const advances of [1,2,4,5]){
  const open=vi.fn(core.relief_render_new),free=vi.fn(core.relief_render_free),tracked={...core,relief_render_new:open,relief_render_free:free};
  const task=wasmRenderRelief(tracked,maps,unit(maps),options);
  for(let i=0;i<advances;i++){const step=task.next();if(step.done)break;}
  task.return();expect(open).toHaveBeenCalledOnce();expect(free).toHaveBeenCalledOnce();expect(free).toHaveBeenCalledWith(open.mock.results[0].value);
 }
});
it('rejects invalid input before allocating and releases a failed or trapped stage',()=>{
 const maps=mapsFor(17,19),open=vi.fn(core.relief_render_new),tracked={...core,relief_render_new:open};
 for(const wrong of [{...maps,width:0},{...maps,heightMap:new Uint8Array(1)},{...maps,mask:new Uint8Array(1)}])expect(drain(wasmRenderRelief(tracked,wrong,1,{rgba:true})).value).toBeNull();
 expect(drain(wasmRenderRelief(tracked,maps,NaN)).value).toBeNull();expect(open).not.toHaveBeenCalled();
 for(const step of [()=>-1,()=>{throw Error('trap')}]){
  const free=vi.fn(core.relief_render_free);expect(()=>drain(wasmRenderRelief({...core,relief_render_step:step,relief_render_free:free},maps,1,{rgba:true}))).toThrow();expect(free).toHaveBeenCalledOnce();
 }
});
it('uses one scoped job with no transfer arenas for the multistage pipeline',()=>{
 const maps=mapsFor(128,193),allocate=vi.fn(core.alloc_f64),open=vi.fn(core.relief_render_new),free=vi.fn(core.relief_render_free);
 const tracked={...core,alloc_f64:allocate,relief_render_new:open,relief_render_free:free};
 const result=drain(wasmRenderRelief(tracked,maps,unit(maps),{layers,rgba:true})).value;
 expect(result.normal.length).toBe(128*193*4);expect(allocate).not.toHaveBeenCalled();expect(open).toHaveBeenCalledOnce();expect(free).toHaveBeenCalledOnce();
});
it('keeps neutral normals exact for flat coating interiors, signed zero and disabled layers',()=>{
 const maps=mapsFor(17,33,0,true);maps.mask.fill(255);maps.owners.fill(1);maps.heightMap.fill(127);maps.baseMask.fill(255);maps.baseHeight.fill(127);
 for(const gain of [0,-0,.03,1,-1,1e6]){
  const result=drain(wasmRenderRelief(core,maps,unit(maps)*gain,{selectionAlpha:true})).value;
  bytes(result.normal,drain(wasmHeightToNormals(core,maps,unit(maps)*gain,{selectionAlpha:true})).value);
  for(let i=0;i<result.normal.length;i+=4)expect(Array.from(result.normal.subarray(i,i+4))).toEqual([128,128,255,255]);
 }
 const result=drain(wasmRenderRelief(core,maps,unit(maps),{layers:[],rgba:true,selectionAlpha:true})).value;
 expect(result.pixels.mask.every(value=>value===0)).toBe(true);
 for(let i=0;i<result.normal.length;i+=4)expect(Array.from(result.normal.subarray(i,i+4))).toEqual([128,128,255,0]);
});
