// The scene's per-entry pose stage: the former per-entry motion sample, three's updateMatrix,
// the room multiply and the projection call, against one RustSceneEntryFrame.step per frame.
// Same inputs, outputs asserted equal; Node/WASM, no DOM, GPU or battery measurement.
// node scripts/benchmark-scene-entry-frame.mjs [dir with inhouse_read_shelf.js + _bg.wasm]
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
import assert from 'node:assert/strict';
import * as THREE from 'three';
const dir=resolve(process.argv[2]||'src/wasm/shelf');
const rust=await import(pathToFileURL(dir+'/inhouse_read_shelf.js').href);
rust.initSync({module:readFileSync(dir+'/inhouse_read_shelf_bg.wasm')});
const {createSceneProjectionFrame}=await import('../src/js/scene-projection-frame.js');
const {createSceneMotionFrame}=await import('../src/js/scene-motion-frame.js');
const {createSceneEntryFrame,ENTRY_INPUT,ENTRY_OUTPUT}=await import('../src/js/scene-entry-frame.js');
const median=a=>a.toSorted((x,y)=>x-y)[Math.floor(a.length/2)],results=[];
const motionKey=entry=>entry.kind===1?`plant:${entry.index}`:entry.kind===2?`lamp:${entry.index}`:entry.index%3===0?`book:drive:${entry.index}`:null;
for(const count of [40,120,300])for(const mode of ['resting','moving']){
 const scene=new rust.RustScene(390,1200,390,162,false,true,0),motion=new rust.RustRoomMotion(),transition=new rust.RustRoomTransition();
 const projection=createSceneProjectionFrame(rust),motionFrame=createSceneMotionFrame(rust,motionKey),entryFrame=createSceneEntryFrame(rust);
 const rows=[{left:12,bottom:300},{left:12,bottom:620},{left:12,bottom:940}],room=new THREE.Object3D();
 room.rotation.set(.244,-.524,0);room.scale.setScalar(.62);room.position.set(40,-12,0);room.updateMatrixWorld(true);
 const entries=Array.from({length:count},(_,index)=>({index,kind:index%13===5?1:index%17===3?2:0,shelf:index%3,box:Float64Array.of(-14,-90,-7,14,110,7),
  pose:new THREE.Object3D(),model:{},overview:index%4===0,bits:0}));
 const poses=entries.map(()=>new THREE.Object3D()),rect={};
 // The pose stage's inputs as the scene sets them every frame: position, Euler rotation, scale.
 function setPose(entry,tick){
  const wobble=mode==='moving'?Math.sin(tick*.07+entry.index)*.02:0;
  entry.pose.position.set(entry.index%20*18-180,-(entry.shelf*320+120),-40+wobble*10);
  entry.pose.rotation.set(0,Math.PI/2-wobble,wobble,entry.index%2?'ZYX':'XYZ');entry.pose.scale.setScalar(1+wobble);
 }
 function begin(tick){scene.beginEntries(tick*16,false,.62,[0,0,0,1],2,390,0,44);motionFrame.prepare(entries,rows,390,650);}
 let sink=0;
 function previous(tick,out){begin(tick);projection.prepare(entries);const matrix=new THREE.Matrix4();
  for(let i=0;i<count;i++){const e=entries[i];setPose(e,tick);
   const flags=motionFrame.sample(i,e.pose,motion,transition,tick*16,false);
   e.pose.updateMatrix();matrix.multiplyMatrices(room.matrixWorld,e.pose.matrix);
   projection.project(scene,e,e.kind,e.bits,null,null,matrix);const v=projection.projection;
   rect.left=v[30];rect.top=v[32];rect.width=v[34];rect.height=v[35];sink+=rect.left+flags+v[37];
   if(out)out.push([flags,...e.pose.matrix.elements,...matrix.elements,...v.slice(30,42)]);
  }}
 const matrix=new THREE.Matrix4();
 function current(tick,out){begin(tick);entryFrame.prepare(count);let input=entryFrame.input;
  for(let i=0;i<count;i++){const e=entries[i];setPose(e,tick);const at=i*ENTRY_INPUT,p=e.pose.position,q=e.pose.quaternion;
   input[at]=p.x;input[at+1]=p.y;input[at+2]=p.z;input[at+3]=q.x;input[at+4]=q.y;input[at+5]=q.z;input[at+6]=q.w;input[at+7]=e.pose.scale.x;
   input[at+8]=e.kind;input[at+9]=e.bits;input[at+10]=0;input[at+11]=0;input[at+12]=e.model?1:0;input[at+13]=e.overview?1:0;input[at+14]=0;input[at+15]=0;
   input.set(e.box,at+16);}
  entryFrame.step(motionFrame.native,scene,motion,transition,tick*16,false,room.matrixWorld);const v=entryFrame.output;
  for(let i=0;i<count;i++){const e=entries[i],at=i*ENTRY_OUTPUT;
   e.pose.matrix.fromArray(v,at+26);e.pose.matrixWorldNeedsUpdate=true;matrix.fromArray(v,at+42);
   rect.left=v[at+58];rect.top=v[at+60];rect.width=v[at+62];rect.height=v[at+63];sink+=rect.left+v[at]+v[at+65];
   if(out)out.push([v[at],...e.pose.matrix.elements,...matrix.elements,...v.slice(at+58,at+70)]);
  }}
 try{
  for(let tick=0;tick<60;tick++){const a=[],b=[];previous(tick,a);current(tick,b);
   for(let i=0;i<count;i++)for(let k=0;k<a[i].length;k++)assert.ok(Object.is(a[i][k],b[i][k]),`entry ${i} value ${k}: ${a[i][k]} vs ${b[i][k]}`);}
  const loops=60,time=fn=>{const start=performance.now();for(let i=0;i<loops;i++)fn(i);return(performance.now()-start)/loops;};
  const old=[],batched=[];
  for(let round=0;round<31;round++){if(round%2){batched.push(time(current));old.push(time(previous));}else{old.push(time(previous));batched.push(time(current));}}
  results.push({count,mode,perEntryCallsMs:+median(old).toFixed(4),oneCallMs:+median(batched).toFixed(4),speedup:+(median(old)/median(batched)).toFixed(2),sink:Number.isFinite(sink)});
 }finally{projection.free();motionFrame.free();entryFrame.free();scene.free();motion.free();transition.free();}
}
console.log(JSON.stringify({date:new Date().toISOString(),scope:'scene pose stage per frame, Node/WASM, shared host',results},null,1));
