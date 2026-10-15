// @vitest-environment node
// The walnut cabinet is drawn by the numeric core (cabinet_build) and compared, byte for byte, with the
// frozen JavaScript original: every beam, lip and plank, the merging by material, the part names and
// bounds. (The contact shadows that share its measures are compared in shelf-occlusion-wasm.test.js.)
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {beforeAll,afterEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({core:null}));
vi.mock('../../src/js/rust-core.js',()=>({loadedRustCore:()=>{if(!state.core)throw new Error('El módulo numérico no está cargado.');return state.core;}}));
import {createShelfFurniture} from '../../src/js/shelf-furniture.js';
import {createShelfFurniture as originalFurniture} from './helpers/reference-shelf-furniture.js';
let core;
beforeAll(async()=>{core=(await WebAssembly.instantiate(readFileSync('src/wasm/inhouse_read_core.wasm'))).instance.exports;expect(typeof core.cabinet_build).toBe('function');state.core=core;});
afterEach(()=>{state.core=core;});
const bytes=array=>Buffer.from(array.buffer,array.byteOffset,array.byteLength);
function exact(a,b){
 expect(a.index).toEqual(b.index);expect(Object.keys(a.attributes)).toEqual(Object.keys(b.attributes));
 for(const name of Object.keys(b.attributes)){
  const left=a.attributes[name],right=b.attributes[name];
  expect(left.constructor,name).toBe(right.constructor);expect(left.array.constructor,name).toBe(right.array.constructor);
  expect(left.itemSize,name).toBe(right.itemSize);expect(left.normalized,name).toBe(right.normalized);expect(left.count,name).toBe(right.count);
  expect(bytes(left.array).equals(bytes(right.array)),`${name}: every byte`).toBe(true);
  expect(left.array.buffer.byteLength,'own buffer').toBe(left.array.byteLength);
 }
 expect(a.groups).toEqual(b.groups);expect(a.userData).toEqual(b.userData);
 expect(a.boundingBox).toEqual(b.boundingBox);expect(a.boundingSphere).toEqual(b.boundingSphere);
}
function same(actual,expected){
 expect(actual.children.length).toBe(expected.children.length);
 expect(actual.userData.parts).toEqual(expected.userData.parts);
 expect(Object.keys(actual.userData)).toEqual(Object.keys(expected.userData));
 for(const key of ['furniture','boardHeight','textureScale','scale'])expect(actual.userData[key]).toBe(expected.userData[key]);
 expect(actual.name).toBe(expected.name);expect(actual.scale).toEqual(expected.scale);
 for(let i=0;i<expected.children.length;i++){
  const a=actual.children[i],b=expected.children[i];
  expect(a.material).toBe(b.material);expect(a.name).toBe(b.name);expect(a.castShadow).toBe(b.castShadow);expect(a.receiveShadow).toBe(b.receiveShadow);
  exact(a.geometry,b.geometry);
 }
}
function materials(){return{wood:new THREE.MeshStandardMaterial(),backWood:new THREE.MeshStandardMaterial(),darkWood:new THREE.MeshStandardMaterial()};}
function compare(options){
 const actual=createShelfFurniture(options),expected=originalFurniture(options);
 try{same(actual,expected);}finally{actual.userData.disposeGeometry();expected.userData.disposeGeometry();}
}
for(const count of [0,1,3,8,100])it(`draws ${count} shelves exactly as the original at every scale`,()=>{
 const m=materials();
 for(const scale of [undefined,.4,.65,1,1.3,0,NaN])compare({width:600*(scale||.65),height:1160*(scale||.65),depth:250*(scale||.65),rows:Array.from({length:count},(_,i)=>({bottom:(i+1)*170*(scale||.65)})),...m,scale});
});
it('groups roles that share a material object exactly like the original (every identity pattern)',()=>{
 const a=new THREE.MeshStandardMaterial(),b=new THREE.MeshStandardMaterial(),c=new THREE.MeshStandardMaterial();
 const rows=[{bottom:210},{bottom:420}];
 for(const pattern of [{wood:a,backWood:b,darkWood:c},{wood:a,backWood:a,darkWood:c},{wood:a,backWood:b,darkWood:a},{wood:a,backWood:b,darkWood:b},{wood:a,backWood:a,darkWood:a},
  {wood:a},{backWood:b},{darkWood:c},{wood:a,darkWood:c},{backWood:b,darkWood:c},{wood:a,backWood:b},{wood:null,backWood:b,darkWood:undefined}])
  compare({width:390,height:754,depth:155,rows,...pattern});
 const none=()=>createShelfFurniture({width:390,height:754,depth:155,rows});
 expect(none).toThrow(TypeError);expect(none).toThrow('createShelfFurniture requires a shared wood material');
});
it('matches a pseudo-random corpus of fractional, malformed and extreme cabinets',()=>{
 let seed=41842;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 const m=materials(),odd=[NaN,Infinity,-Infinity,-5,0,-0,1e-9,1e12,1e300,'390',null,undefined,{}];
 for(let trial=0;trial<400;trial++){
  const pick=(low,span,rate)=>trial%rate===0?odd[Math.floor(random()*odd.length)]:random()*span+low;
  const rows=Array.from({length:Math.floor(random()*8)},()=>{
   const kind=random();
   if(kind<.1)return null;if(kind<.2)return{};if(kind<.3)return{bottom:NaN};if(kind<.4)return{bottom:-random()*20};if(kind<.5)return{bottom:'12'};
   if(kind<.6)return{bottom:Math.floor(random()*5)*100};return{bottom:random()*900};
  });
  rows.push({bottom:rows.find(row=>row&&row.bottom>0)?.bottom??50},{bottom:0},{bottom:-0});
  compare({width:pick(.001,1000,7),height:pick(.001,1400,11),depth:pick(.001,300,13),rows,...m,scale:trial%5===0?random()*2:undefined});
 }
});
it('keeps lip contour triangulation equal to three.js (the constant inside the core)',()=>{
 const contour=[[6,0],[9,0],[10.25,-.3],[11.1,-1],[11.55,-2],[11.7,-3.2],[11.7,-12.2],[11.5,-13.35],[10.9,-14.3],[9.9,-14.85],[8.8,-15],[6,-15]].map(([z,y])=>new THREE.Vector2(z,y));
 expect(THREE.ShapeUtils.triangulateShape(contour,[])).toEqual([[1,0,11],[11,10,9],[9,8,7],[7,6,5],[5,4,3],[3,2,1],[1,11,9],[9,7,5],[5,3,1],[1,9,5]]);
});
it('keeps geometry independent when WASM grows or its arena is reused',()=>{
 const free=vi.fn(core.free_f64);
 state.core={...core,free_f64:free,cabinet_build(...args){core.memory.grow(1);return core.cabinet_build(...args);}};
 const m=materials(),options={width:390,height:754,depth:155,rows:[{bottom:210},{bottom:420}],...m};
 const actual=createShelfFurniture(options),copy=actual.children.map(mesh=>mesh.geometry.clone());core.memory.grow(1);
 const other=createShelfFurniture({...options,width:300});
 try{actual.children.forEach((mesh,i)=>exact(mesh.geometry,copy[i]));expect(free).toHaveBeenCalledTimes(2);
  state.core=core;same(actual,originalFurniture(options));}
 finally{actual.userData.disposeGeometry();other.userData.disposeGeometry();copy.forEach(geometry=>geometry.dispose());}
});
it('reports an unavailable or failing core instead of working around it, and frees the arena',()=>{
 const m=materials(),options={width:390,height:754,depth:155,rows:[{bottom:210}],...m};
 state.core=null;
 expect(()=>createShelfFurniture(options)).toThrow('El módulo numérico no está cargado.');
 for(const [label,engine,message] of [
  ['allocation',{...core,alloc_f64:()=>0},'El módulo numérico no pudo reservar memoria.'],
  ['rejection',{...core,cabinet_build:()=>0},'El módulo numérico no pudo calcular el armario.'],
  ['trap',{...core,cabinet_build:()=>{throw new Error('trap');}},'trap']]){
  const free=vi.fn(core.free_f64);state.core={...engine,free_f64:free};
  expect(()=>createShelfFurniture(options),label).toThrow(message);
  expect(free).toHaveBeenCalledTimes(label==='allocation'?0:1);
 }
});
it('refuses absurd row counts before writing outside the arena',()=>{
 expect(core.cabinet_build(0,100_001,0,0,0,0)).toBe(0);
});
it('leaves no WASM memory behind and does not grow for repeated cabinets',()=>{
 const m=materials(),options={width:390,height:2100,depth:155,rows:Array.from({length:30},(_,i)=>({bottom:(i+1)*60})),...m};
 createShelfFurniture(options).userData.disposeGeometry();
 const before=core.memory.buffer.byteLength;
 for(let i=0;i<50;i++)createShelfFurniture(options).userData.disposeGeometry();
 expect(core.memory.buffer.byteLength).toBe(before);
});
