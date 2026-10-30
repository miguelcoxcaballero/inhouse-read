// CPU-only benchmark of the complete scene live-pose bridge. This includes
// outgoing snapshots and Three pose writes, but excludes DOM, rendering/network.
import {readFileSync,writeFileSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import * as rust from '../src/wasm/shelf/inhouse_read_shelf.js';
import {createSceneMotionFrame} from '../tests/unit/helpers/scene-frame-per-entry.js';
rust.initSync({module:readFileSync(new URL('../src/wasm/shelf/inhouse_read_shelf_bg.wasm',import.meta.url))});
const median=a=>a.toSorted((a,b)=>a-b)[Math.floor(a.length/2)],key=e=>`book:drive:${e.book.driveFileId}`,results=[];
for(const count of [24,96,240])for(const mode of ['idle','remote','remote+checkpoint']){
 const width=640,ppm=1000,now=100,rows=[{left:0,bottom:300},{left:0,bottom:620},{left:0,bottom:940}];
 const entries=Array.from({length:count},(_,i)=>({book:{driveFileId:`library-record-${i}`},shelf:i%3}));
 const poses=()=>entries.map(()=>new THREE.Object3D()),oldPoses=poses(),newPoses=poses(),oldMotion=new rust.RustRoomMotion(),motion=new rust.RustRoomMotion(),oldBridge=new rust.RustRoomTransition(),bridge=new rust.RustRoomTransition(),frame=createSceneMotionFrame(rust,key);
 const remote=new Float64Array(9),target=new Float64Array(8),transition=new Float64Array(8),oldSnapshots=[],newSnapshots=[],oldLean=[],newLean=[];
 const reset=(pose,i)=>{pose.position.set(i%20*25-width/2,-rows[i%3].bottom+100,12);pose.rotation.set(.02,.1,.04,'ZYX');pose.scale.setScalar(1);};
 let checksum=0;
 if(mode!=='idle'){
  const packet={from:'peer',gesture:'drag',sequence:1,phase:'frame',shelfType:'walnut',poses:entries.map((e,i)=>[key(e),i%3,.12+(i%20)*.015,.12,.04,0,0,.03,Math.sqrt(1-.03*.03),1])};
  oldMotion.receive(packet,0);motion.receive(packet,0);
 }
 if(mode==='remote+checkpoint'){
  const starting=entries.map((e,i)=>[key(e),.1+(i%20)*.015,-.2,.01,0,0,0,1,1]);oldBridge.begin(starting,0);bridge.begin(starting,0);
 }
 function old(){for(let i=0;i<count;i++){
  const entry=entries[i],pose=oldPoses[i];reset(pose,i);
  const sharedKey=key(entry),bay=rows[entry.shelf||0]||rows[0],p=pose.position,q=pose.quaternion;
  oldSnapshots[i]=[sharedKey,entry.shelf||0,(p.x+width/2-(bay.left||0))/ppm,(p.y+(bay.bottom||0))/ppm,p.z/ppm,q.x,q.y,q.z,q.w,pose.scale.x];
  if(oldMotion.pose(sharedKey,now,remote)){
   const bay=rows[remote[0]];
   if(bay){pose.position.set((bay.left||0)-width/2+remote[1]*ppm,-(bay.bottom||0)+remote[2]*ppm,remote[3]*ppm);pose.quaternion.set(...remote.subarray(4,8));pose.scale.setScalar(remote[8]);oldLean[i]=new THREE.Euler().setFromQuaternion(pose.quaternion,'ZYX').z.toFixed(6);}
  }
  target.set([(p.x+width/2)/ppm,p.y/ppm,p.z/ppm,q.x,q.y,q.z,q.w,pose.scale.x]);
  if(oldBridge.pose(sharedKey,target,now,transition)){
   pose.position.set(transition[0]*ppm-width/2,transition[1]*ppm,transition[2]*ppm);pose.quaternion.set(...transition.subarray(3,7));pose.scale.setScalar(transition[7]);oldLean[i]=new THREE.Euler().setFromQuaternion(pose.quaternion,'ZYX').z.toFixed(6);
  }
  pose.updateMatrix();checksum+=pose.matrix.elements[12]+oldSnapshots[i][2];
 }}
 function current(){frame.prepare(entries,rows,width,ppm);for(let i=0;i<count;i++){
  const pose=newPoses[i];reset(pose,i);const flags=frame.sample(i,pose,motion,bridge,now,false),v=frame.output;
  if(flags&1)newSnapshots[i]=[frame.key(i),v[0],v[1],v[2],v[3],v[4],v[5],v[6],v[7],v[8]];
  if(flags&2){pose.position.set(v[9],v[10],v[11]);pose.quaternion.set(v[12],v[13],v[14],v[15]);pose.scale.setScalar(v[16]);newLean[i]=new THREE.Euler().setFromQuaternion(pose.quaternion,'ZYX').z.toFixed(6);}
  if(flags&4){pose.position.set(v[17],v[18],v[19]);pose.quaternion.set(v[20],v[21],v[22],v[23]);pose.scale.setScalar(v[24]);newLean[i]=new THREE.Euler().setFromQuaternion(pose.quaternion,'ZYX').z.toFixed(6);}
  pose.updateMatrix();checksum+=pose.matrix.elements[12]+newSnapshots[i][2];
 }}
 try{
  for(let i=0;i<100;i++){old();current();}
  assert.deepEqual(newSnapshots,oldSnapshots);assert.deepEqual(newLean,oldLean);
  for(let i=0;i<count;i++)assert.deepEqual(newPoses[i].matrix.elements,oldPoses[i].matrix.elements);
  const oldTimes=[],newTimes=[],loops=40;
  const time=fn=>{const start=performance.now();for(let i=0;i<loops;i++)fn();return(performance.now()-start)/loops;};
  for(let round=0;round<31;round++){
   if(round%2){newTimes.push(time(current));oldTimes.push(time(old));}else{oldTimes.push(time(old));newTimes.push(time(current));}
  }
  const oldMs=median(oldTimes),nativeMs=median(newTimes);results.push({count,mode,oldMs,nativeMs,speedup:oldMs/nativeMs,checksum});
 }finally{frame.free();oldMotion.free();motion.free();oldBridge.free();bridge.free();}
}
const report={date:new Date().toISOString(),scope:'synthetic full live-pose bridge; no DOM, network, GPU or battery measurement; shared host load',results};
console.log(JSON.stringify(report,null,2));if(process.argv[2])writeFileSync(process.argv[2],JSON.stringify(report,null,2)+'\n');
