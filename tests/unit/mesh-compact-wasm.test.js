// @vitest-environment node
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {beforeAll,afterEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({core:null}));
vi.mock('../../src/js/rust-core.js',()=>({getRustCore:()=>state.core,loadRustCore:async()=>state.core??(await globalThis.__inhouseRustReady).exports}));
import {rustCompactGeometry} from '../../src/js/mesh-compact-wasm.js';
import {compactGeometry as reference} from './helpers/reference-mesh-compact.js';
import {createBaggebo} from '../../src/js/baggebo-model.js';
import {createBaggebo as originalBaggebo} from './helpers/reference-baggebo-model.js';
let core;
beforeAll(async()=>{core=(await WebAssembly.instantiate(readFileSync('src/wasm/inhouse_read_core.wasm'))).instance.exports;expect(typeof core.mesh_compact).toBe('function');state.core=core;});
afterEach(()=>{state.core=core;});
function bytes(a,b){expect(a.constructor).toBe(b.constructor);expect(a.byteLength).toBe(b.byteLength);const x=new Uint8Array(a.buffer,a.byteOffset,a.byteLength),y=new Uint8Array(b.buffer,b.byteOffset,b.byteLength);for(let i=0;i<x.length;i++)if(x[i]!==y[i])throw Error(`byte[${i}]: ${x[i]} / ${y[i]}`);}
function exact(a,b){expect(a).toBeDefined();expect(Object.keys(a.attributes)).toEqual(Object.keys(b.attributes));for(const name of Object.keys(b.attributes)){const x=a.attributes[name],y=b.attributes[name];expect(x.itemSize).toBe(y.itemSize);expect(x.normalized).toBe(y.normalized);bytes(x.array,y.array);}bytes(a.index.array,b.index.array);expect(a.boundingBox).toEqual(b.boundingBox);expect(a.boundingSphere).toEqual(b.boundingSphere);}
function fixture(count,colours=true){
 const g=new THREE.BufferGeometry(),position=new Float32Array(count*3),normal=new Float32Array(count*3),uv=new Float32Array(count*2),color=new Float32Array(count*3);
 for(let i=0;i<count;i++){const corner=[0,1,2,0,2,3][i%6],pair=Math.floor(i/6);position.set([pair*.123+corner,corner%2,i%6===3?-0:0],i*3);normal.set([.123456,.234567,.96789],i*3);uv.set([corner/3,corner/7],i*2);color.set([.5,.73,.999],i*3);}
 g.setAttribute('position',new THREE.BufferAttribute(position,3));g.setAttribute('uv',new THREE.BufferAttribute(uv,2));g.setAttribute('normal',new THREE.BufferAttribute(normal,3));if(colours)g.setAttribute('color',new THREE.BufferAttribute(color,3));return g;
}
for(const count of [1,5,6,12,120,600,120000])it(`preserves all attributes, pair boundaries and index width for ${count} corners`,()=>{
 const g=fixture(count),a=rustCompactGeometry(g),b=reference(g);try{exact(a,b);expect(a.index.array.constructor).toBe(count>100000?Uint32Array:Uint16Array);}finally{g.dispose();a?.dispose();b.dispose();}
});
it('keeps rounding ties, negative normalized values, differing seams and attribute orders',()=>{
 for(let trial=0;trial<100;trial++){
  const g=fixture(12,trial%2===0),n=g.attributes.normal.array;for(let i=0;i<n.length;i++)n[i]=Math.fround(((i%7)-3.5)/32767+trial/1234567);
  const a=rustCompactGeometry(g),b=reference(g);try{exact(a,b);}finally{g.dispose();a?.dispose();b.dispose();}
 }
});
it('preserves complete BAGGEBO templates and independent copies at every scale',()=>{
 const call=vi.fn(core.mesh_compact);state.core={...core,mesh_compact:call};
 for(const width of [600,390,280]){const a=createBaggebo({width}),b=originalBaggebo({width});try{
  if(width===600)expect(call.mock.calls.length).toBeGreaterThan(0);else expect(call.mock.calls.length).toBe(0);call.mockClear();
  expect(a.children.length).toBe(b.children.length);expect(a.userData.parts).toEqual(b.userData.parts);expect(a.scale).toEqual(b.scale);
  for(let i=0;i<a.children.length;i++){exact(a.children[i].geometry,b.children[i].geometry);expect(a.children[i].material.name).toBe(b.children[i].material.name);}
 }finally{a.userData.dispose();b.userData.dispose();}}
});
it('copies outputs before free and supports memory growth during a call',()=>{
 const free=vi.fn(core.free_f64);state.core={...core,free_f64:free,mesh_compact(...args){core.memory.grow(1);return core.mesh_compact(...args);}};
 const g=fixture(120),a=rustCompactGeometry(g),b=reference(g),other=rustCompactGeometry(g);core.memory.grow(1);try{exact(a,b);expect(free).toHaveBeenCalledTimes(2);}finally{g.dispose();a.dispose();b.dispose();other.dispose();}
});
it('keeps the fallback available and frees failed arenas',()=>{
 const g=fixture(6);try{for(const engine of [null,{}, {...core,alloc_f64:()=>0},{...core,mesh_compact:()=>0},{...core,mesh_compact:()=>{throw Error('trap');}}]){
  const free=vi.fn(core.free_f64);state.core=engine?{...engine,free_f64:free}:null;expect(rustCompactGeometry(g)).toBeUndefined();if(engine?.mesh_compact&&engine.alloc_f64===core.alloc_f64)expect(free).toHaveBeenCalledOnce();
 }}finally{g.dispose();}
});
it('rejects unsupported attributes and invalid samples safely',()=>{
 const g=fixture(6);g.setIndex([0,1,2]);expect(rustCompactGeometry(g)).toBeUndefined();g.setIndex(null);g.attributes.position.array[0]=Infinity;expect(rustCompactGeometry(g)).toBeUndefined();g.attributes.position.array[0]=0;g.attributes.normal.array[0]=1e20;expect(rustCompactGeometry(g)).toBeUndefined();g.dispose();
});
