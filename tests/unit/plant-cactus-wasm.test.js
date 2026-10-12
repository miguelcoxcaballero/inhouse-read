// @vitest-environment node
import {readFileSync} from 'node:fs';
import {beforeAll,expect,it,vi} from 'vitest';
import {rustPlantCactusGeometry} from '../../src/js/plant-cactus-wasm.js';
import {cactusGeometry} from './helpers/reference-plant-cactus.js';
import {referencePlantRandom,createShelfPlant as originalModel,plantSurfacesReady as originalReady} from './helpers/reference-shelf-plants.js';
const observed=vi.hoisted(()=>({core:null}));
vi.mock('../../src/js/rust-decor-core.js',()=>({getRustDecorCore:()=>observed.core,loadRustDecorCore:async()=>observed.core}));
import {createShelfPlant,plantSurfacesReady} from '../../src/js/shelf-plants.js';
let core;
beforeAll(async()=>{core=(await WebAssembly.instantiate(readFileSync('src/wasm/inhouse_read_decor.wasm'))).instance.exports;expect(typeof core.plant_cactus_mesh).toBe('function');});
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

function compare(input,engine=core){
 let at=0;const ref=cactusGeometry(input.length,input.radius,input.bend,()=>input.samples[at++]),actual=rustPlantCactusGeometry(engine,input);
 try{equalGeometry(actual,ref);}finally{actual?.dispose();ref.dispose();}
}
for(const length of [.00001,10,128.375,9812])for(const bend of [-71.4,-0,0,25.1])it(`cactus attributes exact: ${length}/${Object.is(bend,-0)?'-0':bend}`,()=>{
 const random=referencePlantRandom('cactus-f32/'+length+'/'+bend);compare({length,radius:length*.092,bend,samples:Float64Array.from({length:627},random)});
});
it('keeps a seeded corpus and refreshed memory views exact',()=>{
 const random=referencePlantRandom('cactus-corpus');
 for(let n=0;n<64;n++)compare({length:.01+random()*800,radius:.001+random()*60,bend:(random()-.5)*80,samples:Float64Array.from({length:627},random)});
 const engine={...core,plant_cactus_mesh(...args){core.memory.grow(1);return core.plant_cactus_mesh(...args);}};
 compare({length:150,radius:12,bend:-20,samples:new Float64Array(627).fill(.5)},engine);
});
it('releases every arena on rejected or exceptional calls and keeps owned attributes',()=>{
 const input={length:100,radius:12,bend:20,samples:new Float64Array(627).fill(.5)};
 for(const native of [()=>0,()=>{throw Error('kernel');}]){
  const free=vi.fn(core.free_f64);expect(rustPlantCactusGeometry({...core,free_f64:free,plant_cactus_mesh:native},input)).toBeNull();expect(free).toHaveBeenCalledOnce();
 }
 for(const samples of [new Float64Array(1),new Float64Array(627).fill(NaN),new Float64Array(627).fill(1)])expect(rustPlantCactusGeometry(core,{...input,samples})).toBeNull();
 for(const length of [0,-1,Infinity,NaN,1e9])expect(rustPlantCactusGeometry(core,{...input,length})).toBeNull();
 expect(rustPlantCactusGeometry({...core,alloc_f64:()=>0},input)).toBeNull();
});
for(const mode of ['native','cold','allocation','kernel'])it(`whole cactus keeps random sequence and all parts after ${mode}`,async()=>{
 const calls=vi.fn(core.plant_cactus_mesh),free=vi.fn(core.free_f64);
 observed.core=mode==='cold'?null:{...core,plant_cactus_mesh:mode==='kernel'?()=>{throw Error('kernel');}:calls,free_f64:free,...(mode==='allocation'?{alloc_f64:()=>0}:{})};
 const entry={catalogId:'cactus',potId:'akerbar',seed:'same-cactus-'+mode},actual=createShelfPlant(entry),ref=originalModel(entry);
 try{equalModels(actual,ref);if(mode==='native')expect(calls.mock.calls.length).toBeGreaterThan(0);await Promise.all([plantSurfacesReady(),originalReady()]);}
 finally{actual.userData.dispose();ref.userData.dispose();observed.core=null;}
},30_000);
