// @vitest-environment node
import {readFileSync} from 'node:fs';
import {afterAll,beforeAll,expect,it,vi} from 'vitest';
import {rustPlantMonsteraGeometry} from '../../src/js/plant-monstera-wasm.js';
import {monsteraLeafGeometry,monsteraBase} from './helpers/reference-plant-monstera.js';
import {referencePlantRandom,createShelfPlant as originalModel,plantSurfacesReady as originalReady} from './helpers/reference-shelf-plants.js';
const observed=vi.hoisted(()=>({core:null}));
vi.mock('../../src/js/rust-decor-core.js',()=>({getRustDecorCore:()=>observed.core,loadRustDecorCore:async()=>observed.core}));
import {createShelfPlant,plantSurfacesReady} from '../../src/js/shelf-plants.js';
let core,surface;
beforeAll(async()=>{core=(await WebAssembly.instantiate(readFileSync('src/wasm/inhouse_read_decor.wasm'))).instance.exports;expect(typeof core.plant_monstera_mesh).toBe('function');surface=monsteraBase();});
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

afterAll(()=>surface?.dispose());
function compare(input,engine=core){
 let at=0;const ref=monsteraLeafGeometry(input.length,input.width,input.curve,()=>input.samples[at++]);
 const actual=rustPlantMonsteraGeometry(engine,{...input,surface});
 try{equalGeometry(actual,ref);}finally{actual?.dispose();ref.dispose();}
}
const inputFor=(length,width,curve,random)=>{const samples=[random(),random(),random()];return{length,width,curve,samples,tint:samples[0]*.035,twist:(samples[1]-.5)*.16,hue:(samples[2]-.5)*.07};};
for(const length of [.00001,10,128.375,9812])for(const curve of [-.5,-0,0,.75])it(`monstera attributes exact ${length}/${Object.is(curve,-0)?'-0':curve}`,()=>{
 compare(inputFor(length,length*.29,curve,referencePlantRandom('monstera-f32/'+length+'/'+curve)));
});
it('keeps a seeded corpus and refreshed memory views exact',()=>{
 const random=referencePlantRandom('monstera-corpus');
 for(let n=0;n<32;n++)compare(inputFor(.01+random()*800,.001+random()*60,(random()-.5)*.8,random));
 compare(inputFor(80,25,.15,random),{...core,plant_monstera_mesh(...args){core.memory.grow(1);return core.plant_monstera_mesh(...args);}});
});
it('releases scratch memory and never mutates the source surface',()=>{
 const input={...inputFor(80,25,.15,referencePlantRandom('monstera-errors')),surface},ref=surface.clone();
 try{
  for(const native of [()=>0,()=>{throw Error('kernel');}]){
   const free=vi.fn(core.free_f64);expect(rustPlantMonsteraGeometry({...core,free_f64:free,plant_monstera_mesh:native},input)).toBeNull();expect(free).toHaveBeenCalledOnce();
  }
  for(const length of [0,-1,Infinity,NaN,1e9])expect(rustPlantMonsteraGeometry(core,{...input,length})).toBeNull();
  expect(rustPlantMonsteraGeometry({...core,alloc_f64:()=>0},input)).toBeNull();
  rustPlantMonsteraGeometry(core,input).dispose();equalGeometry(surface,ref);
 }finally{ref.dispose();}
});
for(const mode of ['native','cold','allocation','kernel'])it(`whole monstera keeps random sequence and all parts after ${mode}`,async()=>{
 const calls=vi.fn(core.plant_monstera_mesh);observed.core=mode==='cold'?null:{...core,plant_monstera_mesh:mode==='kernel'?()=>{throw Error('kernel');}:calls,...(mode==='allocation'?{alloc_f64:()=>0}:{})};
 const entry={catalogId:'monstera',potId:'gradvis',seed:'same-monstera-'+mode},actual=createShelfPlant(entry),ref=originalModel(entry);
 try{equalModels(actual,ref);if(mode==='native')expect(calls.mock.calls.length).toBeGreaterThan(0);await Promise.all([plantSurfacesReady(),originalReady()]);}
 finally{actual.userData.dispose();ref.userData.dispose();observed.core=null;}
},30_000);
