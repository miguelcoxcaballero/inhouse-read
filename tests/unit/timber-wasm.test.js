// @vitest-environment node
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {beforeAll,afterEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({core:null}));
vi.mock('../../src/js/rust-core.js',()=>({getRustCore:()=>state.core}));
import {rustChamferedTimber,rustShelfLip} from '../../src/js/timber-wasm.js';
import {chamferedTimber,shelfLip,textureOffset,boardTone} from './helpers/reference-timber.js';
import {createShelfFurniture} from '../../src/js/shelf-furniture.js';
import {createShelfFurniture as originalFurniture} from './helpers/reference-shelf-furniture.js';
let core;
beforeAll(async()=>{core=(await WebAssembly.instantiate(readFileSync('src/wasm/inhouse_read_core.wasm'))).instance.exports;expect(typeof core.timber_mesh).toBe('function');state.core=core;});
afterEach(()=>{state.core=core;});
function exact(a,b){
 expect(a).toBeDefined();expect(a.index).toEqual(b.index);expect(Object.keys(a.attributes)).toEqual(Object.keys(b.attributes));
 for(const name of Object.keys(b.attributes)){
  const left=a.attributes[name],right=b.attributes[name];expect(left.constructor).toBe(right.constructor);expect(left.itemSize).toBe(right.itemSize);
  const rawLeft=new Uint32Array(left.array.buffer,left.array.byteOffset,left.array.length),rawRight=new Uint32Array(right.array.buffer,right.array.byteOffset,right.array.length);
  expect(rawLeft.length).toBe(rawRight.length);for(let i=0;i<rawLeft.length;i++)if(rawLeft[i]!==rawRight[i])throw Error(`${name}[${i}]: ${left.array[i]} / ${right.array[i]} (${rawLeft[i]} / ${rawRight[i]})`);
 }
 expect(a.boundingBox).toEqual(b.boundingBox);expect(a.boundingSphere).toEqual(b.boundingSphere);
}
for(const grain of [0,1,2])it(`keeps board faces, real bevels, end grain and normals byte-identical along axis ${grain}`,()=>{
 const seed='shelf-2-board',a=rustChamferedTimber(390,15,155,.7,grain,textureOffset(seed),boardTone(seed)),b=chamferedTimber(390,15,155,.7,grain,seed);
 try{exact(a,b);}finally{a?.dispose();b.dispose();}
});
for(const width of [.01,1,155,390,1200])it(`keeps rounded lip contours and triangulation at width ${width}`,()=>{
 const seed='shelf-4-lip',a=rustShelfLip(width,textureOffset(seed),boardTone(seed)),b=shelfLip(width,seed);
 try{exact(a,b);}finally{a?.dispose();b.dispose();}
});
it('matches two hundred fractional boards, bevel limits and custom tones',()=>{
 let seed=41842;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 for(let trial=0;trial<200;trial++){
  const dimensions=[random()*900+.001,random()*1200+.001,random()*500+.001,trial%5===0?-1:random()*50,trial%3],name='piece-'+trial+'木 🦊',tone=[random(),random(),random()];
  const a=rustChamferedTimber(...dimensions,textureOffset(name),tone),b=chamferedTimber(...dimensions,name,tone);
  try{exact(a,b);}finally{a?.dispose();b.dispose();}
 }
});
it('preserves complete production cabinets, material ownership and merged geometry',()=>{
 for(const count of [3,8,100])for(const scale of [.4,.65,1]){
  const wood=new THREE.MeshStandardMaterial(),backWood=new THREE.MeshStandardMaterial(),darkWood=new THREE.MeshStandardMaterial();
  const options={width:600*scale,height:1160*scale,depth:250*scale,rows:Array.from({length:count},(_,i)=>({bottom:(i+1)*170*scale})),wood,backWood,darkWood,scale};
  const call=vi.fn(core.timber_mesh);state.core={...core,timber_mesh:call};const actual=createShelfFurniture(options),expected=originalFurniture(options);
  try{
   expect(call.mock.calls.length).toBe(actual.userData.parts.length);expect(actual.children.length).toBe(expected.children.length);
   expect(actual.userData.parts).toEqual(expected.userData.parts);expect(actual.scale).toEqual(expected.scale);
   for(let i=0;i<actual.children.length;i++){exact(actual.children[i].geometry,expected.children[i].geometry);expect(actual.children[i].material).toBe(expected.children[i].material);}
  }finally{actual.userData.disposeGeometry();expected.userData.disposeGeometry();wood.dispose();backWood.dispose();darkWood.dispose();}
 }
});
it('keeps geometry independent when WASM grows or its arena is reused',()=>{
 const free=vi.fn(core.free_f64);state.core={...core,free_f64:free,timber_mesh(...args){core.memory.grow(1);return core.timber_mesh(...args);}};
 const actual=rustChamferedTimber(350,12,200,1,1,[.2,.3],[1,.9,.8]),copy=actual.clone();core.memory.grow(1);
 const other=rustShelfLip(240,[.5,.1],[.8,.7,.9]);try{exact(actual,copy);expect(free).toHaveBeenCalledTimes(2);}finally{actual.dispose();copy.dispose();other.dispose();}
});
it('keeps the original cabinet available without an engine and frees failed native buffers',()=>{
 for(const engine of [null,{}, {...core,alloc_f64:()=>0},{...core,timber_mesh:()=>0},{...core,timber_mesh:()=>{throw Error('trap');}}]){
  const free=vi.fn(core.free_f64);state.core=engine?{...engine,free_f64:free}:null;
  expect(rustChamferedTimber(390,15,150,.7,0,[0,0],[1,1,1])).toBeUndefined();
  if(engine?.timber_mesh&&engine.alloc_f64===core.alloc_f64)expect(free).toHaveBeenCalledOnce();
 }
 state.core=null;const material=new THREE.MeshStandardMaterial(),options={width:390,height:754,depth:155,rows:[{bottom:210}],wood:material};
 const actual=createShelfFurniture(options),expected=originalFurniture(options);try{exact(actual.children[0].geometry,expected.children[0].geometry);}finally{actual.userData.disposeGeometry();expected.userData.disposeGeometry();material.dispose();}
});
it('rejects malformed geometry and native buffers without handing invalid vertices to the renderer',()=>{
 for(const dimensions of [[0,1,1,1,0],[1,1,1,NaN,0],[1,1,1,1,4]])expect(rustChamferedTimber(...dimensions,[0,0],[1,1,1])).toBeUndefined();
 const free=vi.fn(core.free_f64);state.core={...core,free_f64:free,timber_mesh(_p,_kind,out){new Float32Array(core.memory.buffer,out,1)[0]=NaN;return 132;}};
 expect(rustShelfLip(390,[0,0],[1,1,1])).toBeUndefined();expect(free).toHaveBeenCalledOnce();
});
