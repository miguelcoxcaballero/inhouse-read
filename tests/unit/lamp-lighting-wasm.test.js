// @vitest-environment node
// The lights of the shelf's lamps as the Rust shelf module decides and aims them, against the frozen three.js original
// (tests/unit/helpers/reference-shelf-lamp-lighting.js): the same scripted rooms, frame after frame, through both modules
// into separate scenes, then every light of both scenes (type, name, transforms, colour, intensity, range, cone, shadow
// camera and matrices, area size) and every answer the managers give are compared bit for bit, signed zeros and NaNs
// included.
import {beforeAll,describe,expect,it,vi} from 'vitest';
import * as THREE from 'three';
import {createShelfLampLighting,ensureAreaLights,MAX_SHELF_LAMP_LIGHTS} from '../../src/js/shelf-lamp-lighting.js';
import {createShelfLampLighting as original,ensureAreaLights as ensureOriginal,MAX_SHELF_LAMP_LIGHTS as ORIGINAL_MAX} from './helpers/reference-shelf-lamp-lighting.js';
import {needRustShelf} from '../../src/js/rust-shelf.js';
import * as module from '../../src/wasm/shelf/inhouse_read_shelf.js';
import {compareRooms,facts,generator,sameFacts} from './helpers/lamp-lighting-scenarios.js';

beforeAll(async()=>{await Promise.all([ensureAreaLights(),ensureOriginal()]);});

describe('lamp lighting from the Rust shelf module',()=>{
 it('keeps the same pool, assignments and light parameters as the original through scripted rooms',()=>{
  const coverage=compareRooms({createMine:createShelfLampLighting,createReference:original,seeds:400,frames:36});
  console.log(JSON.stringify(coverage));
  // Not an empty comparison: lamps of every kind were lit, cones cast shadows and were redrawn, and nothing failed
  // (only the rooms with repeated keys make the original, and so the new module, throw).
  expect(coverage.frames).toBeGreaterThan(15000);expect(coverage.lit).toBeGreaterThan(15000);expect(coverage.shadows).toBeGreaterThan(6000);
  expect(coverage.refreshed).toBeGreaterThan(2000);expect(coverage.answeredTrue).toBeGreaterThan(6000);expect(coverage.filamentFrames).toBeGreaterThan(1500);
  expect(coverage.unexpected,coverage.messages.join()).toBe(0);expect(coverage.duplicated).toBeGreaterThan(5);expect(coverage.facts).toBeGreaterThan(3_000_000);
 },240_000);
 it('keeps the maximum of lights the library owns',()=>{expect(MAX_SHELF_LAMP_LIGHTS).toBe(ORIGINAL_MAX);});
 it('lights the same lamps among many: a thousand lamps, drags, scrolls and power changes',()=>{
  const sceneA=new THREE.Scene(),sceneB=new THREE.Scene(),mine=createShelfLampLighting(sceneA),reference=original(sceneB);
  const random=generator(99),room=new THREE.Group(),classes=new Set();
  const entries=Array.from({length:1000},(_,index)=>{
   const model=new THREE.Group();model.position.set((random()-.5)*500,-100,(random()-.5)*300);room.add(model);
   model.userData.lightEmitter={position:[0,-2,0],color:0xffd19a,intensity:10000,distance:400,...(index%3?{direction:[0,-1,0]}:{}),power:random()<.2?0:1};
   const key=`lamp:${(index*7919)%1000}`;
   return {kind:'lamp',key,model,width:40,rect:{top:index*3,bottom:index*3+40},node:{classList:{contains:name=>classes.has(`${key}|${name}`)}}};
  });
  room.updateMatrixWorld(true);
  for(let frame=0;frame<6;frame++){
   const options={scroll:frame*900,viewportHeight:600,transform:room.matrixWorld};
   if(frame===3)classes.add(`${entries[777].key}|is-dragging`);
   if(frame===4)entries[5].model.userData.lightEmitter.power=0;
   expect(mine.update(entries,options)).toBe(reference.update(entries,options));
   sameFacts(facts(sceneA),facts(sceneB),`frame ${frame}`);
  }
  mine.dispose();reference.dispose();
 },120_000);
 it('reports the lamp that finds no light of its fixture kind while the area-light tables load, like the original',async()=>{
  // Fresh copies of both modules, so that neither has loaded the area-light tables (the fresh one gets the real shelf module).
  vi.resetModules();vi.doMock('../../src/js/rust-shelf.js',async()=>(await import('./helpers/rust-shelf-real.js')).rustShelfMock());
  const fresh=await import('../../src/js/shelf-lamp-lighting.js'),old=await import('./helpers/reference-shelf-lamp-lighting.js');
  const THREE2=await import('three');
  const make=()=>{
   const model=new THREE2.Group();
   model.userData.lightEmitter={position:[0,0,0],color:0xffd19a,intensity:10,distance:100,filaments:[{start:[0,0,0],end:[0,4,0],normal:[1,0,0],width:1},{start:[0,0,1],end:[0,4,1],normal:[1,0,0],width:1}]};
   return {kind:'lamp',key:'lamp:f',model,width:40};
  };
  const ready=[0,0];
  const sceneA=new THREE2.Scene(),sceneB=new THREE2.Scene(),entry=make();
  const a=fresh.createShelfLampLighting(sceneA,{filamentAreas:true,onAreaLightsReady:()=>ready[0]++}),b=old.createShelfLampLighting(sceneB,{filamentAreas:true,onAreaLightsReady:()=>ready[1]++});
  const failure=manager=>{try{manager.update([entry]);return null;}catch(error){return `${error.constructor.name}: ${error.message}`;}};
  const first=failure(a),second=failure(b);
  expect(first).toBe(second);expect(first).toMatch(/TypeError/);
  expect(sceneA.children).toHaveLength(0);expect(sceneB.children).toHaveLength(0);
  await Promise.all([fresh.ensureAreaLights(),old.ensureAreaLights()]);
  await new Promise(resolve=>setTimeout(resolve,0));
  expect(ready[0]).toBe(ready[1]);expect(ready[0]).toBeGreaterThan(0);
  expect(failure(a)).toBeNull();expect(failure(b)).toBeNull();
  sameFacts(facts(sceneA),facts(sceneB),'after the tables arrived');
  expect(sceneA.children).toHaveLength(2);
  a.dispose();b.dispose();
  vi.doUnmock('../../src/js/rust-shelf.js');vi.resetModules();
 });
 it('reports a shelf module that is not loaded instead of working around it',async()=>{
  vi.resetModules();vi.doMock('../../src/js/rust-shelf.js',()=>({needRustShelf:()=>{throw new Error('El módulo de la estantería no está cargado.');}}));
  try{
   const bare=await import('../../src/js/shelf-lamp-lighting.js');
   const manager=bare.createShelfLampLighting(new THREE.Scene());
   expect(()=>manager.update([])).toThrow('El módulo de la estantería no está cargado.');
   expect(()=>manager.prepare([])).toThrow('El módulo de la estantería no está cargado.');
  }finally{vi.doUnmock('../../src/js/rust-shelf.js');vi.resetModules();}
 });
});

// --- the kernels, directly --------------------------------------------------------------------------------------------
describe('lamp light kernels',()=>{
 const shelf=()=>needRustShelf();
 it('refuse buffers of the wrong size and write nothing',()=>{
  const marker=n=>new Float64Array(n).fill(123.5),untouched=array=>array.every(value=>value===123.5);
  const out=marker(40);
  expect(shelf().lamp_root(new Float64Array(15),marker(17))).toBe(false);
  expect(shelf().lamp_root(new Float64Array(16),marker(16))).toBe(false);
  expect(shelf().lamp_quota(new Float64Array(3),8,marker(2))).toBe(false);
  expect(shelf().lamp_plan(new Float64Array(8),new Float64Array(0),new Float64Array(1),0,out)).toBe(false);
  expect(shelf().lamp_plan(new Float64Array(7),new Float64Array(4),new Float64Array(1),0,out)).toBe(false);
  expect(shelf().lamp_plan(new Float64Array(14),new Float64Array(3),new Float64Array(1),0,marker(5))).toBe(false);
  expect(untouched(out)).toBe(true);
  expect(shelf().lamp_light(false,new Float64Array(101),marker(38))).toBe(false);
  expect(shelf().lamp_light(true,new Float64Array(102),marker(37))).toBe(false);
  for(const count of [-1,1.5,NaN,65,Infinity]){const input=new Float64Array(24+10*70);input[16]=count;const result=marker(3+10*70);expect(shelf().lamp_filaments(input,result)).toBe(false);expect(untouched(result)).toBe(true);}
  const input=new Float64Array(24+10*2);input[16]=2;expect(shelf().lamp_filaments(input,marker(3+10*2-1))).toBe(false);
  input[16]=3;expect(shelf().lamp_filaments(input,marker(3+10*3))).toBe(false);
  expect(shelf().lamp_filaments(new Float64Array(10),marker(3))).toBe(false);
 });
 it('give the quota the original gives every kind, for any counts and limit',()=>{
  const oracle=(counts,maxLights)=>{
   let left=Math.max(0,Math.min(MAX_SHELF_LAMP_LIGHTS,maxLights));const quota=counts.map(()=>0);
   counts.forEach((count,kind)=>{if(left>0&&count>0){quota[kind]=1;left--;}});
   for(let grew=true;grew&&left>0;){grew=false;counts.forEach((count,kind)=>{if(left>0&&quota[kind]<count){quota[kind]++;left--;grew=true;}});}
   return quota;
  };
  const random=generator(5);
  for(let trial=0;trial<5000;trial++){
   const kinds=Math.floor(random()*6),counts=Array.from({length:kinds},()=>[0,1,2,3,9,Math.floor(random()*20),2.5,NaN][Math.floor(random()*8)]);
   const limit=[0,1,2,3,7,8,9,100,-3,NaN,Infinity,-Infinity,2.5,Number(' 4 '),random()*12][Math.floor(random()*15)];
   const out=new Float64Array(kinds);
   expect(shelf().lamp_quota(Float64Array.from(counts),limit,out)).toBe(true);
   const expected=oracle(counts,limit);
   expected.forEach((value,i)=>expect(Object.is(out[i],value),`counts ${counts} limit ${limit} kind ${i}: ${out[i]} / ${value}`).toBe(true));
  }
 });
 it('decide a uniform room transform and its inverse like the original',()=>{
  const uniform=matrix=>{
   const e=matrix.elements,size=e[0]**2+e[1]**2+e[2]**2,tolerance=Math.max(1,size)*1e-7;
   return size>0&&Number.isFinite(size)&&matrix.determinant()>0&&Math.abs(e[4]**2+e[5]**2+e[6]**2-size)<=tolerance&&Math.abs(e[8]**2+e[9]**2+e[10]**2-size)<=tolerance&&
    Math.abs(e[0]*e[4]+e[1]*e[5]+e[2]*e[6])<=tolerance&&Math.abs(e[0]*e[8]+e[1]*e[9]+e[2]*e[10])<=tolerance&&Math.abs(e[4]*e[8]+e[5]*e[9]+e[6]*e[10])<=tolerance;
  };
  const random=generator(21),out=new Float64Array(17);let accepted=0,refused=0;
  for(let trial=0;trial<4000;trial++){
   const s=()=>[.001,.5,1,2.4,1e6,-1,0,NaN,Infinity][Math.floor(random()*9)];
   const matrix=new THREE.Matrix4().compose(new THREE.Vector3((random()-.5)*1e3,(random()-.5)*1e3,(random()-.5)*1e3),
    new THREE.Quaternion().setFromEuler(new THREE.Euler((random()-.5)*7,(random()-.5)*7,(random()-.5)*7)),
    trial%3===0?new THREE.Vector3(s(),s(),s()):trial%3===1?new THREE.Vector3(1,1,1).multiplyScalar(s()):new THREE.Vector3(2,2*(1+(random()-.5)*2e-7),2));
   if(trial%11===0)matrix.elements[Math.floor(random()*16)]=[NaN,Infinity,0,-0][Math.floor(random()*4)];
   expect(shelf().lamp_root(Float64Array.from(matrix.elements),out)).toBe(true);
   expect(out[0]!==0,`trial ${trial}`).toBe(uniform(matrix));
   if(out[0]!==0){
    accepted++;const inverse=matrix.clone().invert();
    inverse.elements.forEach((value,i)=>expect(Object.is(out[1+i],value),`inverse[${i}] of trial ${trial}`).toBe(true));
   }else refused++;
  }
  expect(accepted).toBeGreaterThan(300);expect(refused).toBeGreaterThan(300);
 });
 it('leave no handles or memory behind over thousands of frames',async()=>{
  const exports=await module.default(),scene=new THREE.Scene(),manager=createShelfLampLighting(scene);
  const room=new THREE.Group(),entries=Array.from({length:12},(_,index)=>{
   const model=new THREE.Group();model.position.set(index*40,-100,-80);room.add(model);
   model.userData.lightEmitter={position:[0,-2,0],color:0xffd19a,intensity:10000,distance:400,...(index%2?{direction:[0,-1,0]}:{})};
   return {kind:'lamp',key:`lamp:${index}`,model,width:40,rect:{top:index*100,bottom:index*100+40}};
  });
  room.updateMatrixWorld(true);
  const frame=i=>manager.update(entries,{scroll:(i*37)%900,viewportHeight:600,transform:room.matrixWorld,shadowDirty:i%50===0});
  for(let i=0;i<300;i++)frame(i);
  const handles=module.shelf_live_handles(),capacity=exports.memory.buffer.byteLength;
  for(let i=0;i<5000;i++)frame(i);
  expect(module.shelf_live_handles()).toBe(handles);expect(exports.memory.buffer.byteLength).toBe(capacity);
  manager.dispose();
 });
});
