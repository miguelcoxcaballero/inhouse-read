// @vitest-environment node
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {beforeAll,afterEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({core:null}));
vi.mock('../../src/js/rust-core.js',()=>({getRustCore:()=>state.core,loadRustCore:async()=>state.core??(await globalThis.__inhouseRustReady).exports}));
import {rustExpandedMetal} from '../../src/js/metal-sheet-wasm.js';
import {createBaggebo} from '../../src/js/baggebo-model.js';
import {createBaggebo as originalBaggebo} from './helpers/reference-baggebo-model.js';
import {expandedMetal as reference} from './helpers/reference-metal-sheet.js';
let core;
beforeAll(async()=>{core=(await WebAssembly.instantiate(readFileSync('src/wasm/inhouse_read_core.wasm'))).instance.exports;expect(typeof core.metal_sheet_prepare).toBe('function');state.core=core;});
afterEach(()=>{state.core=core;});
function exact(a,b){expect(a).toBeDefined();expect(a.index).toBeNull();expect(Object.keys(a.attributes)).toEqual(Object.keys(b.attributes));for(const name of Object.keys(b.attributes)){const x=a.attributes[name],y=b.attributes[name];expect(x.itemSize).toBe(y.itemSize);expect(x.array.length).toBe(y.array.length);const xv=new Uint32Array(x.array.buffer,x.array.byteOffset,x.array.length),yv=new Uint32Array(y.array.buffer,y.array.byteOffset,y.array.length);for(let i=0;i<xv.length;i++)if(xv[i]!==yv[i])throw Error(`${name}[${i}] ${x.array[i]} / ${y.array[i]}`);}}
const native=(bounds,kind=0,z=0)=>rustExpandedMetal(...bounds,kind,z,13.2,7.2,.9,.65);
function original(bounds,kind=0,z=0){return reference(...bounds,kind===0?(u,v,n)=>[u,n,-v]:(u,v,n)=>[v,-u,z+n]);}
for(const bounds of [[-283.75,283.75,15,235],[24,1140,-100,100],[-10,10,-10,10],[0,1,0,1],[-.001,.001,-.001,.001]])for(const kind of [0,1])it(`preserves cut apertures and pressed facets ${bounds} orientation ${kind}`,()=>{
 const a=native(bounds,kind,-249),b=original(bounds,kind,-249);try{exact(a,b);}finally{a?.dispose();b.dispose();}
});
it('keeps one hundred fractional cuts byte identical',()=>{
 let seed=438451;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 for(let i=0;i<100;i++){const x=random()*40-20,y=random()*40-20,bounds=[x,x+random()*100+.1,y,y+random()*200+.1],kind=i%2,z=random()*100-50;const a=native(bounds,kind,z),b=original(bounds,kind,z);try{exact(a,b);}finally{a?.dispose();b.dispose();}}
});
it('frees the prepared mesh and keeps copied buffers across memory growth',()=>{
 const free=vi.fn(core.metal_sheet_free),arena=vi.fn(core.free_f64);state.core={...core,metal_sheet_free:free,free_f64:arena,metal_sheet_prepare(...args){core.memory.grow(1);return core.metal_sheet_prepare(...args);}};
 const bounds=[-50,50,0,100],a=native(bounds),b=original(bounds);const other=native([0,20,0,20]);core.memory.grow(1);try{exact(a,b);expect(free).toHaveBeenCalledTimes(2);expect(arena).toHaveBeenCalledTimes(2);}finally{a.dispose();b.dispose();other.dispose();}
});
it('returns a fallback for unsupported ranges and failures and releases every handle',()=>{
 for(const bounds of [[0,0,0,10],[0,Infinity,0,10],[-10000,10000,-10000,10000]])expect(native(bounds)).toBeUndefined();
 const release=vi.fn(core.metal_sheet_free);state.core={...core,metal_sheet_count:()=>0,metal_sheet_free:release};expect(native([0,10,0,10])).toBeUndefined();expect(release).toHaveBeenCalledOnce();
 state.core=null;expect(native([0,10,0,10])).toBeUndefined();
});

it('keeps the assembled cabinet geometry and materials after native sheet generation',()=>{
 const call=vi.fn(core.metal_sheet_prepare);state.core={...core,metal_sheet_prepare:call};const a=createBaggebo(),b=originalBaggebo();
 try{
  expect(call.mock.calls.length).toBeGreaterThanOrEqual(2);expect(a.children.length).toBe(b.children.length);expect(a.userData.parts).toEqual(b.userData.parts);
  for(let i=0;i<a.children.length;i++){
   const left=a.children[i].geometry,right=b.children[i].geometry;expect(left.index.array.constructor).toBe(right.index.array.constructor);
   for(const name of ['index',...Object.keys(right.attributes)]){
    const x=name==='index'?left.index.array:left.attributes[name].array,y=name==='index'?right.index.array:right.attributes[name].array;
    expect(x.byteLength).toBe(y.byteLength);const xb=new Uint8Array(x.buffer,x.byteOffset,x.byteLength),yb=new Uint8Array(y.buffer,y.byteOffset,y.byteLength);for(let at=0;at<xb.length;at++)if(xb[at]!==yb[at])throw Error(`${i}/${name}[${at}] differs`);
   }
   expect(left.boundingBox).toEqual(right.boundingBox);expect(left.boundingSphere).toEqual(right.boundingSphere);expect(a.children[i].material.name).toBe(b.children[i].material.name);
  }
 }finally{a.userData.dispose();b.userData.dispose();}
});
