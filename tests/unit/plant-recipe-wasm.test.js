// @vitest-environment node
// A shelf plant as production makes it (one recipe call into the shelf module, rust-ui/src/plant_recipe.rs)
// against the frozen three.js original: what it asks of its host and in which order (the paint queue's order
// shows while the textures fill in), how many three.js materials, textures, geometries and objects it makes
// and in which order, every material's options and textures (their sharing between plants included), the
// plant's own data, and what a colour change, an inspection upgrade and a disposal leave behind.
import {afterAll,describe,expect,it,vi} from 'vitest';
const host=vi.hoisted(()=>({log:[]}));
vi.mock('../../src/js/shelf-bake-cache.js',async importOriginal=>{
 const actual=await importOriginal();
 return{...actual,
  savedSurface:(...args)=>{host.log.push(['savedSurface',...args]);return actual.savedSurface(...args);},
  loadedShelfBakes:(...args)=>{host.log.push(['loadedShelfBakes']);return actual.loadedShelfBakes(...args);},
  scheduleShelfBakeWrite:(...args)=>{host.log.push(['scheduleShelfBakeWrite']);return actual.scheduleShelfBakeWrite(...args);}};
});
import * as THREE from 'three';
import {createShelfPlant,shelfPlantBakeRecord,plantSurfacesReady} from '../../src/js/shelf-plants.js';
import {createShelfPlant as original,shelfPlantBakeRecord as originalRecord} from './helpers/reference-shelf-plants.js';
import {PLANT_CATALOG,POT_CATALOG,getPotColors} from '../../src/js/plant-catalog-data.js';
import * as module from '../../src/wasm/shelf/inhouse_read_shelf.js';

const counted={plants:0,materials:0,textures:0,objects:0,hostCalls:0,colours:0,upgrades:0,disposals:0};
afterAll(()=>{console.log('plant recipe differential compared',JSON.stringify(counted));});

// Each implementation numbers the texture images it has seen in the order it first used them: two plants of
// one implementation that share an image must share it in the other too.
const sources={a:new Map(),b:new Map()};
const sourceNumber=(side,texture)=>{const map=sources[side];if(!map.has(texture.source))map.set(texture.source,map.size);return map.get(texture.source);};
const textureShot=(side,texture)=>texture&&{
 source:sourceNumber(side,texture),width:texture.image.width,height:texture.image.height,colorSpace:texture.colorSpace,wrapS:texture.wrapS,wrapT:texture.wrapT,
 repeat:texture.repeat.toArray(),offset:texture.offset.toArray(),center:texture.center.toArray(),rotation:texture.rotation,minFilter:texture.minFilter,magFilter:texture.magFilter,
 generateMipmaps:texture.generateMipmaps,format:texture.format,type:texture.type,anisotropy:texture.anisotropy,flipY:texture.flipY,isData:texture.isDataTexture===true};
const MATERIAL_KEYS=['type','roughness','metalness','clearcoat','clearcoatRoughness','bumpScale','sheen','sheenRoughness','alphaTest','alphaToCoverage','specularIntensity','side',
 'vertexColors','transparent','opacity','transmission','ior','thickness','reflectivity','iridescence','anisotropy','flatShading','wireframe','depthWrite','depthTest','visible','envMapIntensity','normalMapType'];
function materialShot(side,material){
 const shot={};for(const key of MATERIAL_KEYS)shot[key]=material[key];
 shot.color=material.color?.getHex();shot.sheenColor=material.sheenColor?.getHex();shot.emissive=material.emissive?.getHex();
 for(const key of ['map','bumpMap','roughnessMap','normalMap','alphaMap','metalnessMap','clearcoatMap'])shot[key]=textureShot(side,material[key])??null;
 shot.bumpIsRoughness=material.bumpMap===material.roughnessMap;shot.mapIsBump=material.map!=null&&material.map===material.bumpMap;
 return shot;
}
/** The whole plant as data: every object in traversal order and, by three's creation numbers, the order its
 * objects, materials, geometries and textures were made in. */
function plantShot(side,group){
 const objects=[],materials=new Map(),geometries=new Map(),textures=new Map();
 group.traverse(object=>{
  const tag=`${objects.length}:${object.name}`;
  objects.push({id:object.id,tag,type:object.type,parent:object.parent?.name??null,position:object.position.toArray(),quaternion:object.quaternion.toArray(),scale:object.scale.toArray(),
   castShadow:object.castShadow,receiveShadow:object.receiveShadow,geometry:object.geometry?.type??null,vertices:object.geometry?.attributes.position.count??0});
  if(object.material&&!materials.has(object.material))materials.set(object.material,tag);
  if(object.geometry&&!geometries.has(object.geometry))geometries.set(object.geometry,tag);
 });
 for(const [material,tag] of materials)for(const key of ['map','bumpMap','roughnessMap'])if(material[key]&&!textures.has(material[key]))textures.set(material[key],`${tag}.${key}`);
 const order=map=>[...map].sort((p,q)=>p[0].id-q[0].id).map(entry=>entry[1]);
 const data=JSON.parse(JSON.stringify(group.userData,(key,value)=>typeof value==='function'?undefined:value));
 return{objects:objects.map(({id,...rest})=>rest),objectOrder:[...objects].sort((p,q)=>p.id-q.id).map(object=>object.tag),
  materials:[...materials].map(([material,tag])=>[tag,materialShot(side,material)]),materialOrder:order(materials),geometryOrder:order(geometries),textureOrder:order(textures),
  data,functions:Object.keys(group.userData).filter(key=>typeof group.userData[key]==='function').sort(),ready:group.userData.ready instanceof Promise};
}
// How many materials and textures a call makes: three numbers them from shared counters. (Objects and
// geometries are not counted: the original merged many small ones, the bake holds only the merged result.)
const probe=()=>{const material=new THREE.Material(),texture=new THREE.Texture();const ids=[material.id,texture.id];material.dispose();texture.dispose();return ids;};
const disposed={material:vi.spyOn(THREE.Material.prototype,'dispose'),texture:vi.spyOn(THREE.Texture.prototype,'dispose')};
const disposals=()=>[disposed.material.mock.calls.length,disposed.texture.mock.calls.length];
function measured(run){
 host.log.length=0;const before=probe(),gone=disposals();
 const result=run();
 const after=probe(),left=disposals();
 return{result,calls:host.log.splice(0),made:after.map((id,i)=>id-before[i]-1),disposed:left.map((count,i)=>count-gone[i]-1)};
}
function both(label,runA,runB){
 const a=measured(runA),b=measured(runB);
 expect(a.calls,`${label}: host calls`).toEqual(b.calls);
 expect(a.made,`${label}: materials and textures made`).toEqual(b.made);
 expect(a.disposed,`${label}: materials and textures disposed`).toEqual(b.disposed);
 counted.hostCalls+=a.calls.length;
 return[a.result,b.result];
}
function compare(label,a,b){
 const x=plantShot('a',a),y=plantShot('b',b);
 expect(x,label).toEqual(y);
 counted.plants++;counted.objects+=x.objects.length;counted.materials+=x.materials.length;counted.textures+=x.textureOrder.length;
}
const settle=async()=>{for(let i=0;i<400;i++){let done=false;plantSurfacesReady().then(()=>{done=true;});await new Promise(resolve=>setTimeout(resolve,5));if(done)return;}throw Error('plant surfaces did not settle');};

let counter=0;
const fresh=entry=>({...entry,seed:`${entry.seed??entry.key}:${counter++}`});
const ENTRIES=[];
for(const plant of PLANT_CATALOG)for(const pot of POT_CATALOG)ENTRIES.push({catalogId:plant.id,potId:pot.id,seed:`recipe-${plant.id}-${pot.id}`,height:150+ENTRIES.length%7*30,width:60});
const LEGACY=['pothos','upright','palm','fern','ivy','zz','succulent','cactus','monstera','leafy','unknown'].map(variant=>({variant,key:`plant:${variant}`,height:180,width:46}));
const label=entry=>entry.catalogId?`${entry.catalogId}/${entry.potId}`:entry.variant;

function round(entry,options){
 const tag=`${label(entry)} ${JSON.stringify(options??{})}${entry.inspectionResolution?' inspected':''}`;
 const [a,b]=both(`${tag} made`,()=>createShelfPlant(entry,options),()=>original(entry,options));
 compare(tag,a,b);
 return{a,b,tag};
}
function release({a,b,tag}){
 both(`${tag} disposed`,()=>a.userData.dispose(),()=>b.userData.dispose());
 both(`${tag} disposed twice`,()=>a.userData.dispose(),()=>b.userData.dispose());
 counted.disposals++;
}
function records(tag){
 const mine=shelfPlantBakeRecord(),theirs=originalRecord();
 expect(mine.models.map(([key,,surfaces])=>[key,[...surfaces]]),`${tag}: remembered bakes`).toEqual(theirs.models.map(([key,,surfaces])=>[key,[...surfaces]]));
}

describe('a shelf plant from one recipe call',()=>{
 it('has the catalogue it is tested on',()=>{expect(PLANT_CATALOG.length).toBeGreaterThanOrEqual(8);expect(POT_CATALOG.length).toBeGreaterThanOrEqual(4);});
 for(let start=0;start<ENTRIES.length;start+=10){
  const chunk=ENTRIES.slice(start,start+10);
  it(`makes ${chunk.map(label).join(', ')} like the original, kept and not kept, drawn and remembered`,async()=>{
   for(const entry of chunk){
    const given=fresh(entry);
    const first=round(given,{persist:true});
    // The same plant again is rebuilt from its remembered bake and shares the first one's images.
    const again=round(given,{persist:true});
    const loose=round(fresh(entry));
    records(first.tag);
    release(first);release(loose);release(again);
   }
   await settle();records('settled');
  },240000);
 }
 it('makes the plants of old records (no catalogue id, no pot: a drawn clay colour) like the original',async()=>{
  for(const entry of LEGACY){
   const kept=round(fresh(entry),{persist:true}),loose=round(fresh(entry));
   release(kept);release(loose);
  }
  await settle();
 },240000);
 it('makes inspected plants (level 2 surfaces, a ready promise) like the original and resolves alike',async()=>{
  for(const entry of [ENTRIES[1],ENTRIES[6],ENTRIES[ENTRIES.length-1],LEGACY[1],LEGACY[7]]){
   const made=round({...fresh(entry),inspectionResolution:256},{persist:true});
   expect(made.a.userData.ready).toBeInstanceOf(Promise);
   await settle();
   expect(await made.a.userData.ready).toBe(await made.b.userData.ready);
   compare(`${made.tag} painted`,made.a,made.b);
   release(made);
  }
 },240000);
 it('recolours a pot and upgrades a plant for inspection like the original',async()=>{
  for(const pot of POT_CATALOG){
   const colours=getPotColors(pot.id);if(colours.length<2)continue;
   const entry={...fresh({catalogId:PLANT_CATALOG[counter%PLANT_CATALOG.length].id,potId:pot.id,seed:`colour-${pot.id}`,height:180,width:60}),potColorId:colours[0].id};
   const made=round(entry,{persist:true});
   for(const colour of [colours[1],colours[1],colours[0],{id:'no-such-colour'}]){
    const [x,y]=both(`${made.tag} to ${colour.id}`,()=>made.a.userData.updatePotColor(colour.id),()=>made.b.userData.updatePotColor(colour.id));
    expect(x).toBe(y);compare(`${made.tag} in ${colour.id}`,made.a,made.b);counted.colours++;
   }
   records(`${made.tag} recoloured`);
   const [p,q]=both(`${made.tag} upgrade`,()=>made.a.userData.prepareSurfaceQuality(256),()=>made.b.userData.prepareSurfaceQuality(256));
   await settle();
   expect(await p.ready).toBe(await q.ready);
   const [applied,theirs]=both(`${made.tag} upgrade applied`,()=>p.apply(),()=>q.apply());
   expect(applied).toBe(theirs);compare(`${made.tag} upgraded`,made.a,made.b);counted.upgrades++;
   const [u,w]=both(`${made.tag} second upgrade`,()=>made.a.userData.prepareSurfaceQuality(0),()=>made.b.userData.prepareSurfaceQuality(0));
   both(`${made.tag} upgrade dropped`,()=>u.dispose(),()=>w.dispose());
   compare(`${made.tag} after a dropped upgrade`,made.a,made.b);
   release(made);
  }
  expect(counted.colours).toBeGreaterThan(8);expect(counted.upgrades).toBeGreaterThan(1);
 },240000);
 it('compared what it says',()=>{
  expect(counted.plants).toBeGreaterThan(ENTRIES.length*3);expect(counted.materials).toBeGreaterThan(counted.plants*2);
  expect(counted.textures).toBeGreaterThan(counted.plants*3);expect(counted.hostCalls).toBeGreaterThan(counted.plants);
 });
 it('leaves no handles or memory behind for repeated plants, kept or not',async()=>{
  const exports=await module.default();
  for(const entry of [...ENTRIES,...LEGACY]){const warm=createShelfPlant(fresh(entry),{persist:true});warm.userData.dispose();}
  await settle();
  const handles=module.shelf_live_handles(),capacity=exports.memory.buffer.byteLength;
  for(let i=0;i<40;i++){const plant=createShelfPlant(fresh(ENTRIES[i%ENTRIES.length]),{persist:i%2===0});plant.userData.dispose();}
  await settle();
  // The twelve remembered bakes and the shared surfaces stay, as before; nothing else may.
  for(let i=0;i<40;i++){const plant=createShelfPlant(fresh(ENTRIES[i%ENTRIES.length]),{persist:i%2===0});plant.userData.dispose();}
  await settle();
  const settled=module.shelf_live_handles();
  for(let i=0;i<40;i++){const plant=createShelfPlant(fresh(ENTRIES[i%ENTRIES.length]),{persist:i%2===0});plant.userData.dispose();}
  await settle();
  expect(module.shelf_live_handles()).toBe(settled);expect(exports.memory.buffer.byteLength).toBe(capacity);expect(handles).toBeGreaterThan(0);
 },240000);
});
