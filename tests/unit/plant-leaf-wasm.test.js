// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll,describe,expect,it,vi } from 'vitest';
import { rustPlantLeafGeometry } from '../../src/js/plant-leaf-wasm.js';
import { referencePlantLeafGeometry,referencePlantRandom,createShelfPlant as originalModel,plantSurfacesReady as originalSurfacesReady } from './helpers/reference-shelf-plants.js';
import { plantLeafCases,plantModelCases,expectedPlantLeafCalls } from '../helpers/plant-leaf-cases.mjs';

const observed = vi.hoisted(()=>({core:null}));
vi.mock('../../src/js/rust-decor-core.js',()=>({getRustDecorCore:()=>observed.core,loadRustDecorCore:async()=>observed.core}));
import { createShelfPlant,plantSurfacesReady } from '../../src/js/shelf-plants.js';

let core;
beforeAll(async()=>{
  core=(await WebAssembly.instantiate(readFileSync(resolve('src/wasm/inhouse_read_decor.wasm')))).instance.exports;
  expect(typeof core.plant_leaf_mesh).toBe('function');
});
const bytes=array=>Buffer.from(array.buffer,array.byteOffset,array.byteLength);
const original=input=>{
  const values=[input.tint/.08,input.hue/.1+.5];let index=0;
  return referencePlantLeafGeometry({...input,random:()=>values[index++]});
};
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
function compare(input,engine=core) {
  // Recover exactly the reference's two floating PRNG operations; input tint
  // literals cannot generally be divided and multiplied back losslessly.
  const randomValues=[input.tint/.08,input.hue/.1+.5];
  const expected=original(input),actual=rustPlantLeafGeometry(engine,{...input,tint:randomValues[0]*.08,hue:(randomValues[1]-.5)*.1});
  try{equalGeometry(actual,expected);}finally{actual?.dispose();expected.dispose();}
}
function trackedCore(overrides={}) {
  const stats={calls:0,allocations:0,releases:0,live:0,peak:0};
  return {stats,engine:{...core,
    alloc_f64(n){const p=core.alloc_f64(n);if(p){stats.allocations++;stats.live+=n*8;stats.peak=Math.max(stats.peak,stats.live);}return p;},
    free_f64(p,n){stats.releases++;stats.live-=n*8;core.free_f64(p,n);},
    plant_leaf_mesh(...args){stats.calls++;return core.plant_leaf_mesh(...args);},...overrides}};
}
describe('complete plant leaf geometry through actual compiled Rust',()=>{
  for(const input of plantLeafCases)it(`keeps ${input.name} positions, normals, colors, UV and topology byte exact`,()=>compare(input));
  it('preserves detailed and simple surfaces, neutral twist and tiny/larger dimensions',()=>{
    for(const input of plantLeafCases)for(const detailed of [false,true])for(const scale of [.00001,1,337.123])
      compare({...input,length:input.length*scale,width:input.width*scale,twist:-0,curve:0,detailed});
  });
  it('matches a deterministic parameter corpus without losing f32 storage or normal accumulation order',()=>{
    const random=referencePlantRandom('rust:leaves:random');
    for(let n=0;n<256;n++)compare({...plantLeafCases[n%plantLeafCases.length],length:.01+random()*600,
      width:.001+random()*80,twist:(random()-.5)*2,curve:(random()-.2)*.8,
      tint:random()*.08,hue:(random()-.5)*.1,detailed:n%3!==0});
  });
  it('releases every arena, returns owned arrays and does not invalidate earlier geometries',()=>{
    const {engine,stats}=trackedCore(),first=rustPlantLeafGeometry(engine,plantLeafCases[0]);
    const snapshots=Object.fromEntries(Object.entries(first.attributes).map(([name,field])=>[name,Buffer.from(bytes(field.array))]));
    try{
      for(const input of plantLeafCases)compare(input,engine);
      for(const [name,before] of Object.entries(snapshots))expect(bytes(first.attributes[name].array)).toEqual(before);
      expect(stats.calls).toBe(9);expect(stats.live).toBe(0);expect(stats.allocations).toBe(stats.releases);
    }finally{first.dispose();}
  });
  it('re-reads output views after memory growth and permits independent nested calls',()=>{
    let entered=false,nested=null;
    const {engine,stats}=trackedCore({plant_leaf_mesh(...args){
      if(!entered){entered=true;nested=rustPlantLeafGeometry(core,plantLeafCases[1]);}
      const count=core.plant_leaf_mesh(...args);core.memory.grow(1);return count;
    }});
    try{compare(plantLeafCases[0],engine);expect(nested).not.toBeNull();expect(stats.live).toBe(0);}
    finally{nested?.dispose();}
  });
  it('fails before allocation for a cold/missing kernel and unsupported input',()=>{
    const allocate=vi.fn(()=>{throw new Error('must not allocate');});
    for(const value of [null,{...core,plant_leaf_mesh:undefined,alloc_f64:allocate}])
      expect(rustPlantLeafGeometry(value,plantLeafCases[0])).toBeNull();
    for(const change of [{length:0},{width:-1},{twist:NaN},{curve:Infinity},{tint:.08},{hue:-.051},{detailed:1},{variant:'unknown'}])
      expect(rustPlantLeafGeometry({...core,alloc_f64:allocate},{...plantLeafCases[0],...change})).toBeNull();
    expect(allocate).not.toHaveBeenCalled();
  });
  it('releases memory after a failing kernel and returns null for allocation failure',()=>{
    const {engine,stats}=trackedCore({plant_leaf_mesh(){throw new Error('kernel fixture');}});
    expect(rustPlantLeafGeometry(engine,plantLeafCases[0])).toBeNull();expect(stats.live).toBe(0);expect(stats.releases).toBe(1);
    expect(rustPlantLeafGeometry({...core,alloc_f64:()=>0},plantLeafCases[0])).toBeNull();
    expect(rustPlantLeafGeometry({...core,alloc_f64(){throw new Error('allocation fixture');}},plantLeafCases[0])).toBeNull();
  });
});

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
describe('actual createShelfPlant production routing and whole-model parity',()=>{
  for(const entry of plantModelCases)it(`keeps the complete ${entry.catalogId} model and the expected real Rust call count`,async()=>{
    const {engine,stats}=trackedCore();observed.core=engine;
    const actual=createShelfPlant(entry),expected=originalModel(entry);
    try{
      equalModels(actual,expected);expect(stats.calls).toBe(expectedPlantLeafCalls[entry.catalogId]);
      expect(stats.live).toBe(0);expect(stats.allocations).toBe(stats.releases);
      await Promise.all([plantSurfacesReady(),originalSurfacesReady()]);
    }finally{actual.userData.dispose();expected.userData.dispose();observed.core=null;}
  },30_000);
  for(const failure of ['cold','allocation','kernel'])it(`preserves downstream PRNG and the whole model after ${failure} fallback`,async()=>{
    observed.core=failure==='cold'?null:failure==='allocation'?{...core,alloc_f64:()=>0}:{...core,plant_leaf_mesh(){throw new Error('kernel fixture');}};
    const entry={catalogId:'succulent',seed:'same-random-after-fallback'},actual=createShelfPlant(entry),expected=originalModel(entry);
    try{equalModels(actual,expected);await Promise.all([plantSurfacesReady(),originalSurfacesReady()]);}
    finally{actual.userData.dispose();expected.userData.dispose();observed.core=null;}
  },30_000);
  it('restores a saved model without rerunning leaf geometry',async()=>{
    const entry={catalogId:'nephrolepis',seed:'rust-bake-reuse'},tracked=trackedCore();observed.core=tracked.engine;
    const first=createShelfPlant(entry,{persist:true}),originalFirst=originalModel(entry,{persist:true});
    await Promise.all([plantSurfacesReady(),originalSurfacesReady()]);
    const before=tracked.stats.calls,second=createShelfPlant(entry,{persist:true});
    const originalSecond=originalModel(entry,{persist:true});
    try{expect(before).toBe(666);expect(tracked.stats.calls).toBe(before);equalModels(second,originalSecond);expect(tracked.stats.live).toBe(0);}
    finally{for(const model of [first,second,originalFirst,originalSecond])model.userData.dispose();observed.core=null;}
  },30_000);
});
