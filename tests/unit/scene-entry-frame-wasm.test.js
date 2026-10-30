// @vitest-environment node
import {expect,it} from 'vitest';
import * as THREE from 'three';
import {rustShelf as rust,shelfWasm} from './helpers/rust-shelf-ready.js';
import {createSceneMotionFrame} from '../../src/js/scene-motion-frame.js';
import {createSceneEntryFrame,ENTRY_INPUT,ENTRY_OUTPUT} from '../../src/js/scene-entry-frame.js';

// The scene's former per-entry path, frozen: the shared-room motion sample as the host wrote it
// (the same original as scene-motion-frame-wasm.test.js), Object3D#updateMatrix, the room's
// multiply and RustScene#projectEntry. One RustSceneEntryFrame.step per frame must give the
// same bits for every entry, in order.
const key=e=>e.kind==='plant'||e.kind==='lamp'?e.key:e.book?.driveFileId?`book:drive:${e.book.driveFileId}`:null;
const packet=(poses,sequence,phase='frame',extra={})=>({from:'peer',gesture:'drag',sequence,phase,shelfType:'walnut',poses,...extra});
function sample(e,pose,rows,width,ppm,motion,transition,now,arranging){
 const sharedKey=key(e),bay=rows[e.shelf||0]||rows[0],remote=new Float64Array(9),bridge=new Float64Array(8);
 let local=null,flags=0;
 if(sharedKey&&bay){
  const p=pose.position,q=pose.quaternion;
  local=[sharedKey,e.shelf||0,(p.x+width/2-(bay.left||0))/ppm,(p.y+(bay.bottom||0))/ppm,p.z/ppm,q.x,q.y,q.z,q.w,pose.scale.x];flags|=1;
  if(!arranging&&motion.pose(sharedKey,now,remote)){
   const target=rows[remote[0]];
   if(target){pose.position.set((target.left||0)-width/2+remote[1]*ppm,-(target.bottom||0)+remote[2]*ppm,remote[3]*ppm);
    pose.quaternion.set(...remote.subarray(4,8));pose.scale.setScalar(remote[8]);flags|=2;}
  }
 }
 if(sharedKey){
  const p=pose.position,q=pose.quaternion,target=Float64Array.of((p.x+width/2)/ppm,p.y/ppm,p.z/ppm,q.x,q.y,q.z,q.w,pose.scale.x);
  if(transition.pose(sharedKey,target,now,bridge)){
   pose.position.set(bridge[0]*ppm-width/2,bridge[1]*ppm,bridge[2]*ppm);
   pose.quaternion.set(...bridge.subarray(3,7));pose.scale.setScalar(bridge[7]);flags|=4;
  }
 }
 return {local,flags};
}
const bits=values=>Array.from(values,value=>Object.is(value,-0)?'-0':String(value));
function previous(scene,e,pose,room,rows,width,ppm,motion,transition,now,arranging){
 const {local,flags}=sample(e,pose,rows,width,ppm,motion,transition,now,arranging);
 pose.updateMatrix();const placed=new THREE.Matrix4().multiplyMatrices(room.matrixWorld,pose.matrix),v=new Float64Array(44);
 v[0]=e.kind==='plant'?1:e.kind==='lamp'?2:0;v[1]=e.bits;v[2]=e.drop?1:0;v[3]=e.insertion?1:0;v[4]=e.model?1:0;v[5]=e.overview?1:0;
 v[6]=e.drop?.complete?1:0;v[7]=e.insertion?.overlayCanvas?1:0;v.set(e.box,8);v.set(placed.elements,14);scene.projectEntry(v);
 return {flags,local:local&&[local[0],...bits(local.slice(1))],pose:bits([...pose.position.toArray(),...pose.quaternion.toArray(),pose.scale.x]),
  matrix:bits(pose.matrix.elements),placed:bits(placed.elements),projection:bits(v.slice(30,42))};
}
function write(frame,index,e,pose){
 frame.refresh();const v=frame.input,at=index*ENTRY_INPUT,p=pose.position,q=pose.quaternion;
 v[at]=p.x;v[at+1]=p.y;v[at+2]=p.z;v[at+3]=q.x;v[at+4]=q.y;v[at+5]=q.z;v[at+6]=q.w;v[at+7]=pose.scale.x;
 v[at+8]=e.kind==='plant'?1:e.kind==='lamp'?2:0;v[at+9]=e.bits;v[at+10]=e.drop?1:0;v[at+11]=e.insertion?1:0;v[at+12]=e.model?1:0;
 v[at+13]=e.overview?1:0;v[at+14]=e.drop?.complete?1:0;v[at+15]=e.insertion?.overlayCanvas?1:0;v.set(e.box,at+16);
}
function read(frame,motionFrame,index,pose){
 frame.refresh();const v=frame.output,at=index*ENTRY_OUTPUT,flags=v[at];
 for(const [flag,from]of [[2,at+10],[4,at+18]])if(flags&flag){
  pose.position.set(v[from],v[from+1],v[from+2]);pose.quaternion.set(v[from+3],v[from+4],v[from+5],v[from+6]);pose.scale.setScalar(v[from+7]);
 }
 return {flags,local:flags&1?[motionFrame.key(index),...bits(v.slice(at+1,at+10))]:null,
  pose:bits([...pose.position.toArray(),...pose.quaternion.toArray(),pose.scale.x]),
  matrix:bits(v.slice(at+26,at+42)),placed:bits(v.slice(at+42,at+58)),projection:bits(v.slice(at+58,at+70))};
}
function entry(i){
 const kind=i%7===3?'plant':i%5===2?'lamp':undefined;
 return {kind,key:kind?`${kind}:${i}${i%4?'':'🌿'}`:undefined,book:kind?undefined:i%3?{driveFileId:`f${i}`}:{},shelf:i===9?99:i%3,
  box:Float64Array.of(-14-i,-90,-7,14+i,110-i,7),bits:0,model:null,overview:false,drop:null,insertion:null};
}

it('gives every entry the bits of the former per-entry sample, matrix, room multiply and projection',()=>{
 const scene=new rust.RustScene(390,1200,390,180,false,false,0),motionFrame=createSceneMotionFrame(rust,key),frame=createSceneEntryFrame(rust);
 const oldMotion=new rust.RustRoomMotion(),motion=new rust.RustRoomMotion(),oldBridge=new rust.RustRoomTransition(),bridge=new rust.RustRoomTransition();
 const room=new THREE.Object3D(),inverse=new Float64Array([0,0,0,1]),seen=new Set();
 let entries=Array.from({length:14},(_,i)=>entry(i)),sequence=0,visible=0;
 try{
  for(let tick=0;tick<700;tick++){
   const now=tick===650?NaN:tick===651?Infinity:tick*16,width=280+(tick%11)*41,ppm=width/.6,arranging=tick%50>31;
   const rows=tick%43<3?[]:[{left:-0,bottom:300},null,{left:width/2,bottom:700}];
   if(tick===180)entries=entries.toReversed();
   if(tick===300){entries[1].book={driveFileId:'changed'};motionFrame.invalidate();}
   if(tick===500)entries=entries.slice(0,9);
   if(tick===560)entries=[...entries,entry(20),entry(21),entry(23)];
   if(tick%250===0)scene.setMode(tick%500===0,false,now,0);
   if(tick%18===0){
    const poses=entries.filter(e=>key(e)).map((e,i)=>[key(e),tick%54===0?999:i%3,.04+tick*.0001,-.12,.01,0,0,Math.sin(i*.03),Math.cos(i*.03),.9]);
    const value=packet(poses,++sequence);expect(motion.receive(value,now)).toBe(oldMotion.receive(value,now));
   }
   if(tick%31===0){const poses=entries.filter(e=>key(e)).map(e=>[key(e),.1,-.2,.02,0,0,0,1,.8]);oldBridge.begin(poses,now);bridge.begin(poses,now);}
   if(tick===400){oldMotion.clear('peer');motion.clear('peer');}
   room.rotation.set(tick%120<60?.244:0,tick%120<60?-.524:0,0);room.scale.setScalar(.5+tick%7*.1);room.position.set(tick%13,-tick%17,0);room.updateMatrixWorld(true);
   scene.beginEntries(now,false,tick%200<100?1:2,inverse,2,tick%140<70?390:800,tick%100<50?0:600,44);
   motionFrame.prepare(entries,rows,width,ppm);frame.prepare(entries.length);
   const poses=entries.map((e,i)=>{
    e.bits=Math.floor(tick/15+i)%64;e.overview=tick%100<40;e.model=(tick+i)%9<5?{}:null;
    e.drop=(tick+i)%150<5?{complete:(tick+i)%150<2}:null;e.insertion=(tick+i)%180<6?{overlayCanvas:(tick+i)%180<3?{}:null}:null;
    const pose=new THREE.Object3D();pose.position.set(i*35-width/2,-200-i*110+Math.floor(tick/3)%20*5,Math.sin(tick)*5);
    pose.rotation.set(.1,Math.cos(tick*.01)*.3,.04,i%2?'ZYX':'XYZ');pose.scale.setScalar(.9+i*.01);return pose;
   });
   const expected=entries.map((e,i)=>previous(scene,e,poses[i].clone(),room,rows,width,ppm,oldMotion,oldBridge,now,arranging));
   entries.forEach((e,i)=>write(frame,i,e,poses[i]));
   if(tick%97===0)shelfWasm.memory.grow(1);
   frame.step(motionFrame.native,scene,motion,bridge,now,arranging,room.matrixWorld);
   if(tick%89===0)shelfWasm.memory.grow(1);
   entries.forEach((e,i)=>{const actual=read(frame,motionFrame,i,poses[i]);seen.add(actual.flags);if(actual.projection[7]==='1')visible++;expect(actual).toEqual(expected[i]);});
  }
  for(const flags of [0,1,3,5,7])expect(seen.has(flags)).toBe(true);
  expect(visible).toBeGreaterThan(1000);
 }finally{frame.free();motionFrame.free();scene.free();oldMotion.free();motion.free();oldBridge.free();bridge.free();}
});

it('releases its arena, refuses use after disposal and holds no host objects',()=>{
 const before=rust.shelf_live_handles(),scene=new rust.RustScene(390,700,390,150,false,true,0),motionFrame=createSceneMotionFrame(rust,key),frame=createSceneEntryFrame(rust);
 const motion=new rust.RustRoomMotion(),bridge=new rust.RustRoomTransition(),room=new THREE.Object3D(),entries=[entry(1)];
 for(let i=0;i<200;i++){
  frame.prepare(i%3?0:1);scene.beginEntries(i,false,1,[0,0,0,1],1,390,0,44);motionFrame.prepare(entries,[{bottom:300}],390,650);
  if(frame.input.length)write(frame,0,entries[0],new THREE.Object3D());
  frame.step(motionFrame.native,scene,motion,bridge,i,false,room.matrixWorld);
  expect(frame.output.length).toBe(frame.input.length/ENTRY_INPUT*ENTRY_OUTPUT);
 }
 frame.free();frame.free();expect(()=>frame.prepare(1)).toThrow('disposed');expect(()=>frame.refresh()).toThrow('disposed');
 motionFrame.free();scene.free();motion.free();bridge.free();expect(rust.shelf_live_handles()).toBe(before);
});
