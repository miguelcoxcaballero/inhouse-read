// @vitest-environment node
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import {beforeAll,afterEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({core:null}));
vi.mock('../../src/js/rust-core.js',()=>({getRustCore:()=>state.core,loadRustCore:async()=>state.core??(await globalThis.__inhouseRustReady).exports}));
import {rustFinishMesh,rustPaintMeshes} from '../../src/js/mesh-finish-wasm.js';
import {physicalPaintUVs,smoothPostNormals} from './helpers/reference-mesh-finish.js';
import {createBaggebo} from '../../src/js/baggebo-model.js';
import {createBaggebo as originalBaggebo,uprightProfile,extrudedSheet} from './helpers/reference-baggebo-model.js';
let core;
beforeAll(async()=>{core=(await WebAssembly.instantiate(readFileSync('src/wasm/inhouse_read_core.wasm'))).instance.exports;expect(typeof core.mesh_finish).toBe('function');state.core=core;});
afterEach(()=>{state.core=core;});
function bytes(a,b){expect(a.constructor).toBe(b.constructor);expect(a.byteLength).toBe(b.byteLength);const x=new Uint8Array(a.buffer,a.byteOffset,a.byteLength),y=new Uint8Array(b.buffer,b.byteOffset,b.byteLength);for(let i=0;i<x.length;i++)if(x[i]!==y[i])throw Error(`byte[${i}]: ${x[i]} / ${y[i]}`);}
function exact(a,b){expect(Object.keys(a.attributes)).toEqual(Object.keys(b.attributes));for(const key of Object.keys(b.attributes)){bytes(a.attributes[key].array,b.attributes[key].array);}if(b.index)bytes(a.index.array,b.index.array);else expect(a.index).toBeNull();}
function post(side=-1,front=1){const {points}=uprightProfile();return extrudedSheet(points.map(p=>[side*(300-p.x),(front>0?0:-250)-front*p.y]),[],1160,0);}
for(const segments of [1,3,8])it(`keeps physical paint UVs on curved/folded geometry at detail ${segments}`,()=>{
 const a=new RoundedBoxGeometry(200,15,230,segments,.6),b=a.clone(),uv=a.attributes.uv,version=uv.version;try{expect(rustFinishMesh(a,0)).toBe(true);physicalPaintUVs(b);exact(a,b);expect(a.attributes.uv===uv).toBe(true);expect(uv.version).toBe(version);}finally{a.dispose();b.dispose();}
});
for(const side of [-1,1])for(const front of [-1,1])it(`keeps smooth walls and independent caps at ${side}/${front}`,()=>{
 const a=post(side,front),b=a.clone(),normal=a.attributes.normal,version=normal.version;try{expect(rustFinishMesh(a,1)).toBe(true);smoothPostNormals(b);exact(a,b);expect(a.attributes.normal===normal).toBe(true);expect(normal.version).toBe(version);expect(rustFinishMesh(a,0)).toBe(true);physicalPaintUVs(b);exact(a,b);}finally{a.dispose();b.dispose();}
});
it('keeps zero-sign grouping, dominant-axis ties and fractional normals',()=>{
 for(let trial=0;trial<100;trial++){
  const a=new THREE.BufferGeometry(),p=new Float32Array(90),n=new Float32Array(90),uv=new Float32Array(60);for(let i=0;i<30;i++){p.set([i%2?-0:0,i,Math.floor(i/6)*.123],i*3);n.set([Math.sin(i+trial),i%7===0?.50001:0,Math.cos(i-trial)],i*3);}a.setAttribute('position',new THREE.BufferAttribute(p,3));a.setAttribute('normal',new THREE.BufferAttribute(n,3));a.setAttribute('uv',new THREE.BufferAttribute(uv,2));const b=a.clone();try{expect(rustFinishMesh(a,1)).toBe(true);smoothPostNormals(b);exact(a,b);expect(rustFinishMesh(a,0)).toBe(true);physicalPaintUVs(b);exact(a,b);}finally{a.dispose();b.dispose();}
 }
});
it('keeps complete assembled cabinet attributes and proves native production calls',()=>{
 const call=vi.fn(core.mesh_finish);state.core={...core,mesh_finish:call};const a=createBaggebo(),b=originalBaggebo();try{expect(call.mock.calls.filter(args=>args[3]===0).length).toBe(1);expect(call.mock.calls.filter(args=>args[3]===1).length).toBe(4);expect(a.children.length).toBe(b.children.length);expect(a.userData.parts).toEqual(b.userData.parts);for(let i=0;i<a.children.length;i++){exact(a.children[i].geometry,b.children[i].geometry);expect(a.children[i].geometry.boundingBox).toEqual(b.children[i].geometry.boundingBox);}}finally{a.userData.dispose();b.userData.dispose();}
});
it('survives heap growth without replacing shared Three attributes',()=>{
 const release=vi.fn(core.free_f64);state.core={...core,free_f64:release,mesh_finish(...args){core.memory.grow(1);return core.mesh_finish(...args);}};const a=post(),b=a.clone();try{expect(rustFinishMesh(a,1)).toBe(true);smoothPostNormals(b);core.memory.grow(1);exact(a,b);expect(release).toHaveBeenCalledOnce();}finally{a.dispose();b.dispose();}
});
it('falls back atomically on malformed data, missing core and trapped calls',()=>{
 const a=post(),copy=a.attributes.normal.array.slice();try{
  for(const engine of [null,{}, {...core,alloc_f64:()=>0},{...core,mesh_finish:()=>0},{...core,mesh_finish:()=>{throw Error('trap');}}]){const free=vi.fn(core.free_f64);state.core=engine?{...engine,free_f64:free}:null;expect(rustFinishMesh(a,1)).toBe(false);bytes(a.attributes.normal.array,copy);if(engine?.mesh_finish&&engine.alloc_f64===core.alloc_f64)expect(free).toHaveBeenCalledOnce();}
  state.core=core;a.attributes.position.array[0]=NaN;expect(rustFinishMesh(a,1)).toBe(false);bytes(a.attributes.normal.array,copy);expect(rustFinishMesh(a,5)).toBe(false);
 }finally{a.dispose();}
});

it('paints a whole assembly in one native call while retaining every attribute',()=>{
 const call=vi.fn(core.mesh_finish);state.core={...core,mesh_finish:call};const a=Array.from({length:20},(_,i)=>new RoundedBoxGeometry(200+i,15,230,1,.6)),b=a.map(g=>g.clone()),uv=a.map(g=>g.attributes.uv);
 try{expect(rustPaintMeshes(a)).toBe(true);expect(call).toHaveBeenCalledOnce();b.forEach(physicalPaintUVs);for(let i=0;i<a.length;i++){exact(a[i],b[i]);expect(a[i].attributes.uv===uv[i]).toBe(true);}}finally{for(const g of [...a,...b])g.dispose();}
});
it('does not partially paint earlier meshes when the final one is invalid',()=>{
 const a=[post(),post(1)],before=a.map(g=>g.attributes.uv.array.slice());a[1].attributes.normal.array[0]=NaN;try{expect(rustPaintMeshes(a)).toBe(false);a.forEach((g,i)=>bytes(g.attributes.uv.array,before[i]));}finally{a.forEach(g=>g.dispose());}
});
