// @vitest-environment node
import * as THREE from 'three';
import {readFileSync} from 'node:fs';
import {beforeAll,expect,it,vi} from 'vitest';
import {rustPlantSubdivide} from '../../src/js/plant-subdivide-wasm.js';
import {subdivideSurface} from './helpers/reference-plant-subdivide.js';
import {createShelfPlant as originalModel,plantSurfacesReady as originalReady} from './helpers/reference-shelf-plants.js';
const observed=vi.hoisted(()=>({core:null}));
vi.mock('../../src/js/rust-decor-core.js',()=>({getRustDecorCore:()=>observed.core,loadRustDecorCore:async()=>observed.core??(await globalThis.__inhouseDecorReady).exports}));
import {createShelfPlant,plantSurfacesReady} from '../../src/js/shelf-plants.js';
let core;
beforeAll(async()=>{core=(await WebAssembly.instantiate(readFileSync('src/wasm/inhouse_read_decor.wasm'))).instance.exports;expect(typeof core.plant_subdivide).toBe('function');});
const bytes=array=>Buffer.from(array.buffer,array.byteOffset,array.byteLength);
function equalGeometry(actual,expected) {
  expect(actual).not.toBeNull();expect(actual.type).toBe(expected.type);
  expect(Object.keys(actual.attributes)).toEqual(Object.keys(expected.attributes));
  for(const name of [...Object.keys(expected.attributes),'index']) {
    const a=name==='index'?actual.index:actual.attributes[name],b=name==='index'?expected.index:expected.attributes[name];
    if(!b){expect(a,name).toBeNull();continue;}
    expect(a.constructor.name,name).toBe(b.constructor.name);expect(a.array.constructor.name,name).toBe(b.array.constructor.name);
    expect(a.itemSize,name).toBe(b.itemSize);expect(a.count,name).toBe(b.count);
    expect(a.normalized,name).toBe(b.normalized);expect(a.version,name).toBe(b.version);
    expect(Buffer.compare(bytes(a.array),bytes(b.array)),`${name} exact bytes`).toBe(0);
    expect(a.array.buffer,name).not.toBe(core.memory.buffer);
  }
  expect(actual.groups).toEqual(expected.groups);expect(actual.userData).toEqual(expected.userData);
  expect(actual.drawRange).toEqual(expected.drawRange);
  expect(actual.boundingBox).toEqual(expected.boundingBox);expect(actual.boundingSphere).toEqual(expected.boundingSphere);
}
function equalModels(actual,expected) {
  const a=[],b=[];actual.traverse(object=>a.push(object));expected.traverse(object=>b.push(object));
  expect(a).toHaveLength(b.length);
  for(let index=0;index<a.length;index++) {
    const x=a[index],y=b[index];expect(x.name).toBe(y.name);expect(x.type).toBe(y.type);
    expect(x.children.map(child=>child.name)).toEqual(y.children.map(child=>child.name));
    for(const field of ['position','quaternion','scale','rotation','matrix','matrixWorld'])expect(x[field].toArray(),`${x.name} ${field}`).toEqual(y[field].toArray());
    for(const field of ['castShadow','receiveShadow','renderOrder','visible'])expect(x[field]).toBe(y[field]);
    if(y.geometry)equalGeometry(x.geometry,y.geometry);
    if(y.material)for(const field of ['type','roughness','metalness','clearcoat','clearcoatRoughness','side','alphaTest','bumpScale','vertexColors','specularIntensity'])expect(x.material[field],`${x.name} ${field}`).toBe(y.material[field]);
  }
}

const triangle=(positions,indices)=>{const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setIndex(indices);return g;};
function compare(source,engine=core){
 const actual=source.clone(),ref=source.clone();
 try{expect(rustPlantSubdivide(engine,actual)).toBe(true);subdivideSurface(ref);equalGeometry(actual,ref);}finally{actual.dispose();ref.dispose();source.dispose();}
}
for(const size of [1,2,6,16,48])it(`subdivision exact for ${size}x${size} faces`,()=>compare(new THREE.PlaneGeometry(10.37,19.27,size,size)));
it('keeps shared and degenerate edge insertion order and signed zeros',()=>compare(triangle([-0,0,-0,1.3,-2,3,4,5.1,6,-8,2.7,1],[0,1,2,2,1,3,0,0,1,3,2,1])));
it('keeps curved holed shape vertices and normals identical',()=>{
 const shape=new THREE.Shape();shape.moveTo(0,0);shape.bezierCurveTo(-4,1,-4,8,0,10);shape.quadraticCurveTo(8,6,0,0);
 const hole=new THREE.Path();hole.absellipse(0,5,1,2,0,Math.PI*2,true,.3);shape.holes.push(hole);
 for(const segments of [2,5,12,32])compare(new THREE.ShapeGeometry(shape,segments));
});
it('refreshes views after native memory growth',()=>compare(new THREE.PlaneGeometry(1,1,8,8),{...core,plant_subdivide(...args){core.memory.grow(1);return core.plant_subdivide(...args);}}));
for(const mode of ['cold','allocation','reject','throw'])it(`leaves the source unchanged after ${mode}`,()=>{
 const geometry=new THREE.PlaneGeometry(2,5,4,7),ref=geometry.clone(),free=vi.fn(core.free_f64);
 const engine=mode==='cold'?null:{...core,free_f64:free,...(mode==='allocation'?{alloc_f64:()=>0}:{plant_subdivide:mode==='reject'?()=>0:()=>{throw Error('kernel');}})};
 try{expect(rustPlantSubdivide(engine,geometry)).toBe(false);equalGeometry(geometry,ref);expect(free).toHaveBeenCalledTimes(['reject','throw'].includes(mode)?1:0);}finally{geometry.dispose();ref.dispose();}
});
it('rejects malformed triangles and unbounded input',()=>{
 for(const geometry of [triangle([0,0,0,1,0,0,0,1,0],[0,1,3]),triangle([0,0,0,1,0,0,0,1,0],[0,1]),triangle([NaN,0,0,1,0,0,0,1,0],[0,1,2]),new THREE.PlaneGeometry(1,1,100,100)]){
  const ref=geometry.clone();try{expect(rustPlantSubdivide(core,geometry)).toBe(false);equalGeometry(geometry,ref);}finally{geometry.dispose();ref.dispose();}
 }
});
for(const mode of ['native','cold','allocation','kernel'])it(`whole monstera keeps its fenestrations after ${mode}`,async()=>{
 const calls=vi.fn(core.plant_subdivide);observed.core=mode==='cold'?null:{...core,plant_subdivide:mode==='kernel'?()=>{throw Error('kernel');}:calls,...(mode==='allocation'?{alloc_f64:()=>0}:{})};
 const entry={catalogId:'monstera',potId:'gradvis',seed:'same-subdivision-'+mode},actual=createShelfPlant(entry),ref=originalModel(entry);
 try{equalModels(actual,ref);if(mode==='native')expect(calls.mock.calls.length).toBeGreaterThan(0);await Promise.all([plantSurfacesReady(),originalReady()]);}
 finally{actual.userData.dispose();ref.userData.dispose();observed.core=null;}
},30_000);
