// @vitest-environment node
import * as THREE from 'three';
import {readFileSync} from 'node:fs';
import {beforeAll,expect,it,vi} from 'vitest';
import {rustPlantPotSurface} from '../../src/js/plant-pot-wasm.js';
import {potGeometry,potProfile} from './helpers/reference-plant-pot.js';
import {createShelfPlant as originalModel,plantSurfacesReady as originalReady} from './helpers/reference-shelf-plants.js';
const observed=vi.hoisted(()=>({core:null}));
vi.mock('../../src/js/rust-core.js',()=>({getRustCore:()=>observed.core,loadRustCore:async()=>observed.core}));
import {createShelfPlant,plantSurfacesReady} from '../../src/js/shelf-plants.js';
let core;
beforeAll(async()=>{core=(await WebAssembly.instantiate(readFileSync('src/wasm/inhouse_read_core.wasm'))).instance.exports;expect(typeof core.plant_pot_surface).toBe('function');});
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

function accelerated(potId,outerRadius,height,soil,engine=core){
 const raw=potProfile(potId),fullHeight=Math.max(...raw.map(([,y])=>y)),profile=raw.map(([r,y])=>[r,y/fullHeight]);
 const radius=outerRadius/(Math.max(...profile.map(([r])=>r))+(potId==='gradvis'?.018:0)),segments=potId==='gradvis'?96:potId==='muskot'?40:48;
 const geometry=new THREE.LatheGeometry(profile.map(([r,y])=>new THREE.Vector2(r*radius,y*height)),segments);
 const before=geometry.clone(),soilRadius=rustPlantPotSurface(engine,geometry,potId,profile,segments,radius,height,soil);
 return{geometry,soilRadius,radius,before};
}
for(const pot of ['muskot','gradvis','akerbar','terracotta','unknown'])for(const [r,h,soil] of [[.01,.013,.84],[12,15,.84],[57.3,81.9,.77],[1200,980,.93]])it(`pot exact ${pot}/${r}/${h}/${soil}`,()=>{
 const actual=accelerated(pot,r,h,soil),ref=potGeometry(pot,r,h,soil);
 try{expect(actual.soilRadius).toBe(ref.soilRadius);expect(actual.radius).toBe(ref.radius);equalGeometry(actual.geometry,ref.geometry);expect(actual.geometry.parameters).toEqual(ref.geometry.parameters);}
 finally{actual.geometry.dispose();actual.before.dispose();ref.geometry.dispose();}
});
it('refreshes memory views and leaves previous owned attributes independent',()=>{
 const engine={...core,plant_pot_surface(...args){core.memory.grow(1);return core.plant_pot_surface(...args);}};
 const actual=accelerated('gradvis',60,85,.84,engine),ref=potGeometry('gradvis',60,85,.84);
 try{equalGeometry(actual.geometry,ref.geometry);}finally{actual.geometry.dispose();actual.before.dispose();ref.geometry.dispose();}
});
for(const failure of ['cold','allocate','reject','throw'])it(`pot fallback is atomic for ${failure}`,()=>{
 const free=vi.fn(core.free_f64),engine=failure==='cold'?null:{...core,free_f64:free,...(failure==='allocate'?{alloc_f64:()=>0}:{plant_pot_surface:failure==='reject'?()=>0:()=>{throw Error('kernel');}})};
 const actual=accelerated('gradvis',60,85,.84,engine);
 try{expect(actual.soilRadius).toBeNull();equalGeometry(actual.geometry,actual.before);expect(free).toHaveBeenCalledTimes(['reject','throw'].includes(failure)?1:0);}
 finally{actual.geometry.dispose();actual.before.dispose();}
});
for(const pot of ['muskot','gradvis','akerbar','terracotta'])it(`whole plant retains ${pot} shapes, materials and transforms`,async()=>{
 const calls=vi.fn(core.plant_pot_surface);observed.core={...core,plant_pot_surface:calls};
 const entry={catalogId:'monstera',potId:pot,seed:'same-pot-'+pot},actual=createShelfPlant(entry),ref=originalModel(entry);
 try{equalModels(actual,ref);expect(calls).toHaveBeenCalledOnce();await Promise.all([plantSurfacesReady(),originalReady()]);}
 finally{actual.userData.dispose();ref.userData.dispose();observed.core=null;}
},30_000);

it('rejects malformed pot inputs without exposing mutations',()=>{
 const raw=potProfile('gradvis'),profile=raw.map(([r,y])=>[r,y]),geometry=new THREE.LatheGeometry(profile.map(([r,y])=>new THREE.Vector2(r*60,y*85)),96),before=geometry.clone();
 const free=vi.fn(core.free_f64),engine={...core,free_f64:free};
 try{
  for(const soil of [-1,1,NaN,Infinity])expect(rustPlantPotSurface(engine,geometry,'gradvis',profile,96,60,85,soil)).toBeNull();
  expect(rustPlantPotSurface(engine,geometry,'gradvis',profile,129,60,85,.84)).toBeNull();
  const invalid=profile.map(pair=>[...pair]);invalid[2][0]=NaN;
  expect(rustPlantPotSurface(engine,geometry,'gradvis',invalid,96,60,85,.84)).toBeNull();
  expect(free).toHaveBeenCalledOnce();equalGeometry(geometry,before);
 }finally{geometry.dispose();before.dispose();}
});
