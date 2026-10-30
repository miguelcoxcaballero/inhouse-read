// @vitest-environment node
// Every shelf plant as the Rust shelf module builds it against the frozen three.js original: the baked scene (each object
// in creation order with its place, transform, role and geometry bytes, the boxes and the group of the foliage) for every
// catalogue plant in every pot at several seeds and heights, the objects the host makes from it and their ownership.
import {afterEach,describe,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({loaded:true,calls:0,randoms:0,bakes:[]}));
vi.mock('../../src/js/rust-shelf.js',async importOriginal=>{
 const actual=await importOriginal();
 const counted=new Proxy(actual.needRustShelf(),{get(target,name){
  if(name==='plant_bake_build')return(...args)=>{state.calls++;if(state.bakes.length<60)state.bakes.push(args);return target.plant_bake_build(...args);};
  if(name==='plant_random')return(...args)=>{state.randoms++;return target.plant_random(...args);};
  return target[name];}});
 return{...actual,needRustShelf:()=>{if(!state.loaded)throw new Error('El módulo de la estantería no está cargado.');return counted;}};
});
import {createShelfPlant,shelfPlantBakeRecord} from '../../src/js/shelf-plants.js';
import {createShelfPlant as original,shelfPlantBakeRecord as originalRecord} from './helpers/reference-shelf-plants.js';
import {PLANT_CATALOG,POT_CATALOG} from '../../src/js/plant-catalog-data.js';
import * as module from '../../src/wasm/shelf/inhouse_read_shelf.js';
import {readPacket} from './helpers/geo-packet.js';
// Frozen unpackBake of shelf-plants.js (1.7.325), before the packet was read in Rust (rust-ui/src/plant_build.rs).
function unpackBake(bytes){
 const packet=readPacket(bytes),{parts,objects}=packet.header;
 return {parts,objects:objects.map(({geometry,rotation,...object})=>({...object,rotation:[...rotation,'XYZ'],
  geometry:geometry?{type:geometry.type,attributes:Object.fromEntries(geometry.attributes.map(([name,size,kind,at,length])=>[name,[packet.copy(kind,at,length),size,false]])),
   index:geometry.index&&packet.copy(geometry.index[0],geometry.index[1],geometry.index[2]),groups:geometry.groups,userData:geometry.userData,box:geometry.box}:null}))};
}
afterEach(()=>{state.loaded=true;});
const bytes=array=>Buffer.from(array.buffer,array.byteOffset,array.byteLength);
const typeOf=value=>Object.prototype.toString.call(value).slice(8,-1);
/** Deep equality with Object.is on numbers and the bytes of typed arrays. */
function same(actual,expected,path){
 if(ArrayBuffer.isView(expected)){
  expect(typeOf(actual),path).toBe(typeOf(expected));expect(actual.length,`${path} length`).toBe(expected.length);
  if(!bytes(actual).equals(bytes(expected))){for(let i=0;i<expected.length;i++)if(!Object.is(actual[i],expected[i]))throw Error(`${path}[${i}] ${actual[i]} / ${expected[i]}`);}
  return;
 }
 if(Array.isArray(expected)){
  expect(Array.isArray(actual),path).toBe(true);expect(actual.length,`${path} length`).toBe(expected.length);
  expected.forEach((value,i)=>same(actual[i],value,`${path}[${i}]`));return;
 }
 if(expected&&typeof expected==='object'){
  expect(Object.keys(actual).sort(),`${path} keys`).toEqual(Object.keys(expected).sort());
  for(const key of Object.keys(expected))same(actual[key],expected[key],`${path}.${key}`);return;
 }
 if(!Object.is(actual,expected))throw Error(`${path}: ${actual} / ${expected}`);
}
const ENTRIES=[];
for(const plant of PLANT_CATALOG)for(const pot of POT_CATALOG)ENTRIES.push({catalogId:plant.id,potId:pot.id,seed:`seed-${plant.id}-${pot.id}`,height:150+ENTRIES.length%7*30});
for(const variant of ['pothos','upright','palm','fern','ivy','zz','succulent','cactus','monstera','leafy','unknown'])ENTRIES.push({variant,key:`plant:${variant}`,height:180});
let counter=0;
const fresh=entry=>({...entry,key:`${entry.key??entry.seed}:${counter++}`,seed:entry.seed?`${entry.seed}:${counter}`:undefined});
function compareBake(entry){
 const options={persist:true},given=fresh(entry);
 const a=createShelfPlant(given,options),b=original(given,options);
 try{
  const [key,bake,surfaces]=shelfPlantBakeRecord().models.at(-1),[otherKey,otherBake,otherSurfaces]=originalRecord().models.at(-1);
  expect(key).toBe(otherKey);expect([...surfaces]).toEqual([...otherSurfaces]);
  same(bake,otherBake,`${entry.catalogId??entry.variant}/${entry.potId??'-'} bake`);
  expect(a.userData.parts).toEqual(b.userData.parts);
 }finally{a.userData.dispose();b.userData.dispose();}
}
describe('shelf plants from the Rust shelf module',()=>{
 it('has the catalogue it is tested on',()=>{expect(PLANT_CATALOG.length).toBeGreaterThanOrEqual(8);expect(POT_CATALOG.length).toBeGreaterThanOrEqual(4);});
 for(let start=0;start<ENTRIES.length;start+=12){
  const chunk=ENTRIES.slice(start,start+12);
  it(`bakes ${chunk.map(entry=>entry.catalogId?`${entry.catalogId}/${entry.potId}`:entry.variant).join(', ')} like the original`,()=>{for(const entry of chunk)compareBake(entry);},120000);
 }
 it('makes the same objects: names, places, transforms, shadows, geometry classes and materials',()=>{
  const walk=group=>{const list=[];group.traverse(object=>list.push(object));return list;};
  for(const entry of [ENTRIES[0],ENTRIES[7],ENTRIES[20],ENTRIES.find(e=>e.catalogId==='cactus'),ENTRIES.find(e=>e.catalogId==='nephrolepis'),ENTRIES.find(e=>e.catalogId==='hedera')]){
   if(!entry)continue;
   const given=fresh(entry),a=createShelfPlant(given),b=original(given);
   try{
    const x=walk(a),y=walk(b);expect(x.length).toBe(y.length);
    for(let i=0;i<y.length;i++){
     const tag=`${entry.catalogId} ${y[i].name}`;
     expect(x[i].type,tag).toBe(y[i].type);expect(x[i].name,tag).toBe(y[i].name);expect(x[i].parent?.name,tag).toBe(y[i].parent?.name);
     expect(x[i].position.toArray(),tag).toEqual(y[i].position.toArray());expect(x[i].quaternion.toArray(),tag).toEqual(y[i].quaternion.toArray());expect(x[i].scale.toArray(),tag).toEqual(y[i].scale.toArray());
     expect(x[i].castShadow,tag).toBe(y[i].castShadow);expect(x[i].receiveShadow,tag).toBe(y[i].receiveShadow);
     // the plant's own group also holds functions (updatePotColor, ...): compare the data
     const data=object=>JSON.parse(JSON.stringify(object.userData,(key,value)=>typeof value==='function'?undefined:value));
     expect(data(x[i]),tag).toEqual(data(y[i]));
     if(y[i].geometry){expect(x[i].geometry.type,tag).toBe(y[i].geometry.type);expect(x[i].geometry.boundingBox,tag).toEqual(y[i].geometry.boundingBox);expect(x[i].geometry.groups,tag).toEqual(y[i].geometry.groups);
      expect(x[i].material.type,tag).toBe(y[i].material.type);expect(x[i].material.vertexColors,tag).toBe(y[i].material.vertexColors);}
    }
    // creation order: the objects sorted by id are in the same order
    const byId=list=>[...list].sort((p,q)=>p.id-q.id).map(object=>object.name);
    expect(byId(x)).toEqual(byId(y));
    expect(a.userData.parts).toEqual(b.userData.parts);
   }finally{a.userData.dispose();b.userData.dispose();}
  }
 });
 it('draws each plant with one call of the module and gives every plant its own buffers',()=>{
  const entry=ENTRIES.find(e=>e.catalogId==='monstera'),before=state.calls;
  const a=createShelfPlant(fresh(entry)),c=createShelfPlant(fresh(entry));
  try{
   expect(state.calls-before).toBe(2);
   a.traverse(object=>{if(object.geometry)for(const attribute of Object.values(object.geometry.attributes))expect(attribute.array.buffer.byteLength).toBe(attribute.array.byteLength);});
   a.traverse(object=>{if(object.geometry){object.geometry.attributes.position.array.fill(7);object.geometry.index?.array.fill(1);}});
   const given=fresh(entry),b=createShelfPlant(given),d=original(given);
   try{
    const left=[],right=[];b.traverse(o=>{if(o.geometry)left.push(o.geometry.attributes.position.array);});d.traverse(o=>{if(o.geometry)right.push(o.geometry.attributes.position.array);});
    expect(left.length).toBe(right.length);left.forEach((array,i)=>same(array,right[i],`position ${i}`));
   }finally{b.userData.dispose();d.userData.dispose();}
  }finally{a.userData.dispose();c.userData.dispose();}
 });
 it('leaves no handles or memory behind for repeated plants',async()=>{
  const exports=await module.default();
  // Warm every variant once so the linear memory has reached its working size, then repeat them.
  for(const entry of ENTRIES){const warm=createShelfPlant(fresh(entry));warm.userData.dispose();}
  const handles=module.shelf_live_handles(),capacity=exports.memory.buffer.byteLength;
  for(let i=0;i<20;i++){const plant=createShelfPlant(fresh(ENTRIES[i%ENTRIES.length]));plant.userData.dispose();}
  expect(module.shelf_live_handles()).toBe(handles);expect(exports.memory.buffer.byteLength).toBe(capacity);
 });
 it('reports a shelf module that is not loaded instead of working around it',()=>{
  state.loaded=false;
  expect(()=>createShelfPlant(fresh(ENTRIES[0]))).toThrow('El módulo de la estantería no está cargado.');
 });
 it('seeds with the code points of any text like the original (surrogates, empty, numbers)',()=>{
  for(const seed of ['','a','ñandú','\u{1F33F}x\u{1F331}','\ud83c','x\udf3f','0',12345,'plant:long-key-'.repeat(8)]){
   const given=fresh({catalogId:'fern',potId:POT_CATALOG[0].id,height:160}),entry={...given,seed};
   const a=createShelfPlant(entry,{persist:true}),b=original(entry,{persist:true});
   try{
    const record=shelfPlantBakeRecord().models.at(-1),other=originalRecord().models.at(-1);
    same(record[1],other[1],`seed ${JSON.stringify(seed)}`);
   }finally{a.userData.dispose();b.userData.dispose();}
  }
 });
 it('reads every bake packet into the record the original unpacked, keys, arrays and buffers included',()=>{
  expect(state.bakes.length).toBeGreaterThan(20);
  for(const args of state.bakes){
   const read=module.plant_bake_build(...args),expected=unpackBake(module.plant_model(...args));
   const shape=value=>ArrayBuffer.isView(value)?`${typeOf(value)}(${value.length})`:Array.isArray(value)?value.map(shape):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,shape(v)])):value;
   expect(shape(read)).toStrictEqual(shape(expected));
   read.objects.forEach((object,i)=>{
    expect(Object.keys(object)).toEqual(Object.keys(expected.objects[i]));
    if(!object.geometry)return;
    expect(Object.keys(object.geometry.attributes)).toEqual(Object.keys(expected.objects[i].geometry.attributes));
    for(const [name,[array]] of Object.entries(object.geometry.attributes)){
     same(array,expected.objects[i].geometry.attributes[name][0],`object ${i} ${name}`);
     expect(array.buffer.byteLength).toBe(array.byteLength);
    }
    if(object.geometry.index)same(object.geometry.index,expected.objects[i].geometry.index,`object ${i} index`);
   });
  }
 });
 it('serves a plant from its bake without drawing it again',()=>{
  const entry=fresh({catalogId:'sansevieria',potId:POT_CATALOG[0].id,height:170}),first=createShelfPlant(entry,{persist:true}),before=state.calls;
  const second=createShelfPlant(entry,{persist:true});
  try{expect(state.calls).toBe(before);}finally{first.userData.dispose();second.userData.dispose();}
 });
});
