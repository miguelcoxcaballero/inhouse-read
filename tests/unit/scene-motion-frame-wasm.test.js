// @vitest-environment node
import {expect,it} from 'vitest';
import * as THREE from 'three';
import {rustShelf as rust,shelfWasm} from './helpers/rust-shelf-ready.js';
import {createSceneMotionFrame} from './helpers/scene-frame-per-entry.js';

const key=e=>e.kind==='plant'||e.kind==='lamp'?e.key:e.book?.driveFileId?`book:drive:${e.book.driveFileId}`:null;
const packet=(poses,sequence,phase='frame',extra={})=>({from:'peer',gesture:'drag',sequence,phase,shelfType:'walnut',poses,...extra});
function original(e,pose,rows,width,ppm,motion,transition,now,arranging){
 const sharedKey=key(e),bay=rows[e.shelf||0]||rows[0],remote=new Float64Array(9),bridge=new Float64Array(8);
 let local=null,flags=0;const lean=[];
 if(sharedKey&&bay){
  const p=pose.position,q=pose.quaternion;
  local=[sharedKey,e.shelf||0,(p.x+width/2-(bay.left||0))/ppm,(p.y+(bay.bottom||0))/ppm,p.z/ppm,q.x,q.y,q.z,q.w,pose.scale.x];flags|=1;
  if(!arranging&&motion.pose(sharedKey,now,remote)){
   const target=rows[remote[0]];
   if(target){pose.position.set((target.left||0)-width/2+remote[1]*ppm,-(target.bottom||0)+remote[2]*ppm,remote[3]*ppm);
    pose.quaternion.set(...remote.subarray(4,8));pose.scale.setScalar(remote[8]);flags|=2;
    lean.push(new THREE.Euler().setFromQuaternion(pose.quaternion,'ZYX').z.toFixed(6));}
  }
 }
 if(sharedKey){
  const p=pose.position,q=pose.quaternion,target=Float64Array.of((p.x+width/2)/ppm,p.y/ppm,p.z/ppm,q.x,q.y,q.z,q.w,pose.scale.x);
  if(transition.pose(sharedKey,target,now,bridge)){
   pose.position.set(bridge[0]*ppm-width/2,bridge[1]*ppm,bridge[2]*ppm);
   pose.quaternion.set(...bridge.subarray(3,7));pose.scale.setScalar(bridge[7]);flags|=4;
   lean.push(new THREE.Euler().setFromQuaternion(pose.quaternion,'ZYX').z.toFixed(6));
  }
 }
 pose.updateMatrix();return {local,flags,lean};
}
function apply(frame,index,pose,motion,transition,now,arranging){
 const flags=frame.sample(index,pose,motion,transition,now,arranging),v=frame.output,lean=[];
 const local=flags&1?[frame.key(index),...v.slice(0,9)]:null;
 for(const [flag,at]of [[2,9],[4,17]])if(flags&flag){
  pose.position.set(v[at],v[at+1],v[at+2]);pose.quaternion.set(v[at+3],v[at+4],v[at+5],v[at+6]);pose.scale.setScalar(v[at+7]);
  lean.push(new THREE.Euler().setFromQuaternion(pose.quaternion,'ZYX').z.toFixed(6));
 }
 pose.updateMatrix();return {local,flags,lean};
}
it('preserves local snapshots, remote previews and checkpoint transitions across layouts and gesture ownership',()=>{
 const frame=createSceneMotionFrame(rust,key),oldMotion=new rust.RustRoomMotion(),motion=new rust.RustRoomMotion(),oldBridge=new rust.RustRoomTransition(),bridge=new rust.RustRoomTransition();
 let entries=[{book:{driveFileId:'one'},shelf:0},{kind:'plant',key:'plant:🌿',shelf:1},{kind:'lamp',key:'lamp:small',shelf:2},{kind:'plant',key:'plant:\ud800',shelf:99},{book:{},shelf:0}];
 let sequence=0,priorLocal=null;const seen=new Set();
 try{
  for(let tick=0;tick<650;tick++){
   const now=tick*16,width=280+(tick%11)*41,ppm=width/.6;
   const rows=tick%43<3?[]:[{left:-0,bottom:300},null,{left:width/2,bottom:700}];
   if(tick===180)entries=[entries[2],entries[0],entries[4],entries[1],entries[3]];
   if(tick===300){entries[1].book={driveFileId:'changed'};frame.invalidate();}
   if(tick===500)entries=entries.slice(0,3);
   if(tick%18===0){
    const poses=entries.filter(e=>key(e)).map((e,i)=>[key(e),tick%54===0?999:i%3,.04+tick*.0001,-.12,.01,0,0,Math.sin(i*.03),Math.cos(i*.03),.9]);
    const value=packet(poses,++sequence);
    expect(motion.receive(value,now)).toBe(oldMotion.receive(value,now));
   }
   if(tick%31===0){const poses=entries.filter(e=>key(e)).map(e=>[key(e),.1,-.2,.02,0,0,0,1,.8]);oldBridge.begin(poses,now);bridge.begin(poses,now);}
   if(tick===400){oldMotion.clear('peer');motion.clear('peer');}
   frame.prepare(entries,rows,width,ppm);
   for(let i=0;i<entries.length;i++){
    const pose=new THREE.Object3D();pose.position.set(i*35-width/2,-200-i*110,Math.sin(tick)*5);
    pose.rotation.set(.1,Math.cos(tick*.01)*.3,.04,'ZYX');pose.scale.setScalar(.9+i*.01);
    const expectedPose=pose.clone(),arranging=tick%50>31;expectedPose.rotation.copy(pose.rotation);
    const expected=original(entries[i],expectedPose,rows,width,ppm,oldMotion,oldBridge,now,arranging);
    const actual=apply(frame,i,pose,motion,bridge,now,arranging);seen.add(actual.flags);
    expect(actual).toEqual(expected);expect(pose.matrix.elements).toEqual(expectedPose.matrix.elements);expect(pose.rotation.toArray()).toEqual(expectedPose.rotation.toArray());
    if(actual.local){if(priorLocal)expect(priorLocal.value).toEqual(priorLocal.copy);priorLocal={value:actual.local,copy:[...actual.local]};}
   }
  }
  expect(seen.has(0)).toBe(true);expect(seen.has(7)).toBe(true);expect(seen.has(5)).toBe(true);expect(seen.has(3)).toBe(true);
 }finally{frame.free();oldMotion.free();motion.free();oldBridge.free();bridge.free();}
});
it('retains final leases, expiry behavior and peer priority without borrowing host objects',()=>{
 const frame=createSceneMotionFrame(rust,key),oldMotion=new rust.RustRoomMotion(),motion=new rust.RustRoomMotion(),oldBridge=new rust.RustRoomTransition(),bridge=new rust.RustRoomTransition();
 const entries=[{book:{driveFileId:'one'},shelf:0}],rows=[{left:0,bottom:300}],pose=new THREE.Object3D();
 try{
  for(const m of [oldMotion,motion]){
   m.acknowledge('base');m.receive(packet([['book:drive:one',0,.2,.1,.01,0,0,0,1,1]],1,'end',{base:'base',commit:'final'}),0);
   m.receive(packet([['book:drive:one',0,.3,.1,.01,0,0,0,1,1]],1,'frame',{from:'z-peer',base:'base'}),0);
  }
  for(const now of [0,32.5,65,3499,3500,3501,20000,NaN,Infinity]){
   frame.prepare(entries,rows,390,650);const a=pose.clone(),b=pose.clone();
   expect(apply(frame,0,a,motion,bridge,now,false)).toEqual(original(entries[0],b,rows,390,650,oldMotion,oldBridge,now,false));
   expect(a.matrix.elements).toEqual(b.matrix.elements);
  }
  motion.acknowledge('final');oldMotion.acknowledge('final');
  expect(frame.sample(0,pose,motion,bridge,20001,false)).toBe(1);
 }finally{frame.free();oldMotion.free();motion.free();oldBridge.free();bridge.free();}
});
it('refreshes native views after growth, invalidates identity changes and releases retained memory',()=>{
 const before=rust.shelf_live_handles(),frame=createSceneMotionFrame(rust,key),motion=new rust.RustRoomMotion(),bridge=new rust.RustRoomTransition(),pose=new THREE.Object3D();
 const entries=[{book:{driveFileId:'old'},shelf:0}];frame.prepare(entries,[{bottom:300}],390,650);shelfWasm.memory.grow(1);
 expect(frame.sample(0,pose,motion,bridge,0,false)).toBe(1);expect(frame.key(0)).toBe('book:drive:old');
 entries[0].book={driveFileId:'new'};frame.invalidate();frame.prepare(entries,[{bottom:500}],600,1000);shelfWasm.memory.grow(1);
 expect(frame.sample(0,pose,motion,bridge,0,false)).toBe(1);expect(frame.key(0)).toBe('book:drive:new');expect(frame.output[2]).toBe(.5);
 for(let i=0;i<300;i++){frame.invalidate();frame.prepare(entries,[{bottom:i}],600,1000);frame.sample(0,pose,motion,bridge,i,false);}
 frame.free();frame.free();motion.free();bridge.free();expect(()=>frame.prepare([],[],1,1)).toThrow('disposed');expect(rust.shelf_live_handles()).toBe(before);
});
