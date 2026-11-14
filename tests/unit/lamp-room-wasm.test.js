// @vitest-environment node
// The lamp lights' frame in a fixed number of calls (rust-ui/src/lamp_room.rs): what the scripted rooms of
// lamp-lighting-wasm.test.js do not reach. The module's memory growing in the middle of a session (the arena's view is
// then stale), the arena growing with the library, a library without lamps, the handle's lifetime, and the calls a
// frame makes.
import {describe,expect,it,vi} from 'vitest';
import * as THREE from 'three';
import {createShelfLampLighting} from '../../src/js/shelf-lamp-lighting.js';
import {createShelfLampLighting as original} from './helpers/reference-shelf-lamp-lighting.js';
import {needRustShelf} from '../../src/js/rust-shelf.js';
import * as module from '../../src/wasm/shelf/inhouse_read_shelf.js';
import {facts,sameFacts} from './helpers/lamp-lighting-scenarios.js';

function library(lamps,books=0){
 const room=new THREE.Group(),entries=[];
 for(let index=0;index<books;index++)entries.push({kind:'book',key:`book:${index}`,model:null});
 for(let index=0;index<lamps;index++){
  const model=new THREE.Group();model.position.set(index*40,-100,-80);room.add(model);
  model.userData.lightEmitter={position:[0,-2,0],color:0xffd19a,intensity:10000,distance:400,...(index%2?{direction:[0,-1,0]}:{})};
  entries.push({kind:'lamp',key:`lamp:${index}`,model,width:40,rect:{top:index*100,bottom:index*100+40},node:{classList:{contains:()=>false}}});
 }
 room.updateMatrixWorld(true);
 return {room,entries};
}
const pair=options=>{const sceneA=new THREE.Scene(),sceneB=new THREE.Scene();return {sceneA,sceneB,mine:createShelfLampLighting(sceneA,options),reference:original(sceneB,options)};};

describe('the lamp lights of a room in one retained frame',()=>{
 it('aims the same lights after the module memory grew between frames and inside a session',async()=>{
  const exports=await module.default(),shelf=needRustShelf();
  const {room,entries}=library(12,40),{sceneA,sceneB,mine,reference}=pair({preparedEntries:true});
  mine.prepare(entries);reference.prepare(entries);
  const hogs=[];let grown=0;
  for(let frame=0;frame<24;frame++){
   room.rotation.y=frame*.01;room.updateMatrixWorld(true);
   const options={scroll:frame*90,viewportHeight:600,transform:room.matrixWorld,shadowDirty:frame%7===0};
   expect(mine.update(entries,options),`frame ${frame}`).toBe(reference.update(entries,options));
   sameFacts(facts(sceneA),facts(sceneB),`frame ${frame}`);
   if(frame%4===3){
    // Something else in the module takes memory until the module has to grow: every view of the old buffer is detached.
    const before=exports.memory.buffer;
    for(let tries=0;tries<64&&exports.memory.buffer===before;tries++){const hog=new shelf.LampRoomFrame();hog.reserve(60000,8);hogs.push(hog);}
    if(exports.memory.buffer!==before)grown++;
   }
  }
  expect(grown).toBeGreaterThan(3);
  for(const hog of hogs)hog.free();
  mine.dispose();reference.dispose();
 });
 it('follows a library that grows past the arena, and one that loses every lamp',()=>{
  const {sceneA,sceneB,mine,reference}=pair({preparedEntries:true}),options=room=>({scroll:120,viewportHeight:600,transform:room.matrixWorld});
  for(const lamps of [0,1,9,40,300,3,0,0,17]){
   const {room,entries}=library(lamps,5);
   mine.prepare(entries);reference.prepare(entries);
   for(let frame=0;frame<3;frame++){
    expect(mine.update(entries,options(room)),`${lamps} lamps, frame ${frame}`).toBe(reference.update(entries,options(room)));
    sameFacts(facts(sceneA),facts(sceneB),`${lamps} lamps, frame ${frame}`);
    for(const getter of ['activeCount','activePower','shadowCount','shadowRefresh'])expect(Object.is(mine[getter],reference[getter]),getter).toBe(true);
   }
  }
  mine.dispose();reference.dispose();
  expect(sceneA.children).toHaveLength(0);
 });
 it('makes two calls for a frame whatever the number of lamps, and none for a library without lamps',()=>{
  const shelf=needRustShelf(),Frame=shelf.LampRoomFrame,calls={plan:0,sample:0,other:0};
  const spies=['plan','sample','reconcile','reserve','slot_added','slot_removed','filaments','memory'].map(name=>{
   const real=Frame.prototype[name];
   return vi.spyOn(Frame.prototype,name).mockImplementation(function(...args){if(name==='plan'||name==='sample')calls[name]++;else calls.other++;return real.apply(this,args);});
  });
  try{
   const {room,entries}=library(12,30),manager=createShelfLampLighting(new THREE.Scene(),{preparedEntries:true});
   manager.prepare(entries);
   const frame=i=>manager.update(entries,{scroll:i*40,viewportHeight:600,transform:room.matrixWorld});
   frame(0);frame(1);
   Object.assign(calls,{plan:0,sample:0,other:0});
   for(let i=2;i<52;i++)frame(i);
   expect(calls).toEqual({plan:50,sample:50,other:0});
   expect(manager.activeCount).toBe(8);
   manager.dispose();
   const empty=library(0,30),bare=createShelfLampLighting(new THREE.Scene(),{preparedEntries:true});
   bare.prepare(empty.entries);
   Object.assign(calls,{plan:0,sample:0,other:0});
   // The prepare is announced once, as before; nothing is planned or aimed.
   expect(bare.update(empty.entries,{transform:empty.room.matrixWorld})).toBe(true);
   for(let i=0;i<20;i++)expect(bare.update(empty.entries,{transform:empty.room.matrixWorld})).toBe(false);
   expect(calls).toEqual({plan:0,sample:0,other:0});
   bare.dispose();
  }finally{for(const spy of spies)spy.mockRestore();}
 });
 it('refuses a transform with fewer than sixteen numbers, as the module did when it was handed the list',()=>{
  // (The three.js original never met one: it took a Matrix4 and failed inside three.)
  const {sceneA,sceneB,mine,reference}=pair({}),{room,entries}=library(2);
  expect(()=>mine.update(entries,{transform:{elements:[1,0,0,0,0,1,0]}})).toThrow('Las luces de las lámparas no recibieron datos válidos (sala).');
  expect(sceneA.children).toHaveLength(0);
  expect(mine.update(entries,{transform:room.matrixWorld})).toBe(reference.update(entries,{transform:room.matrixWorld}));
  sameFacts(facts(sceneA),facts(sceneB),'after the refusal');
  mine.dispose();reference.dispose();
 });
 it('frees the room with its manager: managers made and disposed leave no handle and no memory behind',async()=>{
  const exports=await module.default();
  const cycle=()=>{
   const {room,entries}=library(10,4),manager=createShelfLampLighting(new THREE.Scene());
   for(let frame=0;frame<4;frame++)manager.update(frame===2?entries.slice(3):entries,{scroll:frame*50,viewportHeight:600,transform:room.matrixWorld});
   manager.dispose();
   // Disposed: neither call reaches the module again.
   manager.prepare(entries);expect(manager.update(entries)).toBe(false);manager.dispose();
  };
  for(let i=0;i<20;i++)cycle();
  const handles=module.shelf_live_handles(),capacity=exports.memory.buffer.byteLength;
  for(let i=0;i<400;i++)cycle();
  expect(module.shelf_live_handles()).toBe(handles);expect(exports.memory.buffer.byteLength).toBe(capacity);
 });
 it('answers false instead of reading past its arena',()=>{
  const shelf=needRustShelf(),frame=new shelf.LampRoomFrame(),ranks=()=>new Float64Array(0);
  try{
   expect(frame.plan(0,0,false,0,ranks)).toBe(false);
   frame.reserve(4,8);
   expect(frame.plan(5,0,false,0,ranks)).toBe(false);
   expect(frame.plan(0,1,false,0,ranks)).toBe(false);
   expect(frame.plan(0,0,true,0,ranks)).toBe(true);
   frame.sample(false);frame.slot_removed(3);
   expect(frame.filaments(0,true,false,new Float64Array(24),new Float64Array(3))).toBe(0);
   frame.slot_added(3,false);
   expect(frame.plan(0,1,false,0,ranks)).toBe(true);
  }finally{frame.free();}
 });
});
