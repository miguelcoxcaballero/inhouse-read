// @vitest-environment node
import {expect,it} from 'vitest';
import * as THREE from 'three';
import {rustShelf as rust,shelfWasm} from './helpers/rust-shelf-ready.js';
import {createSceneMotionFrame} from '../../src/js/scene-motion-frame.js';
import {createSceneEntryFrame,ENTRY_STATE as S,ENTRY_OUTPUT} from '../../src/js/scene-entry-frame.js';
import {createReferenceRoomMotion} from './helpers/reference-room-motion-publish.js';

// The shared room's local motion lives in the entry arena: the entries' local poses, the poses
// at rest per key and the keys a gesture has moved. The frozen host bookkeeping
// (helpers/reference-room-motion-publish.js: an array per entry per frame, a Map, a Set) must
// publish the same rows, bit for bit, through layouts, changed and lost keys, shared keys,
// lifts, drags and growth of the memory.
const motionKey=e=>e.kind==='plant'||e.kind==='lamp'?e.key:e.book?.driveFileId?`book:drive:${e.book.driveFileId}`:null;
function random(seed){let s=seed>>>0;return()=>{s=(s+0x6D2B79F5)>>>0;let t=Math.imul(s^s>>>15,1|s);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
let serial=0;
function entry(next){
 const i=serial++,kind=i%7===3?'plant':i%5===2?'lamp':undefined;
 return {kind,key:kind?`${kind}:${i}${i%4?'':'🌿'}`:`book:${i}`,book:kind?undefined:next()<.2?{}:{driveFileId:next()<.15?'shared':`f${i}`},shelf:i%3,
  x:30+(i%14)*37,y:200+(i%3)*300,width:kind?45:150,height:kind?90:200,depth:150,depthInset:0,box:Float64Array.of(-14,-90,-7,14,110,7),
  bits:0,dragNumberX:0,dragNumberY:0,row:-1,stale:true};
}
const plain=poses=>poses.map(row=>row.map(value=>typeof value==='number'?Object.is(value,-0)?'-0':Number.isNaN(value)?'NaN':value.toString():value));

for(const seed of [1,2,3,4,5,6])it(`publishes the frozen bookkeeping's rows (session ${seed})`,()=>{
 const next=random(seed*7919);serial=0;
 const sceneView=new rust.RustScene(600,1200,600,250,false,false,0),roomMotion=new rust.RustRoomMotion(),roomTransition=new rust.RustRoomTransition();
 const motionFrame=createSceneMotionFrame(rust,motionKey),entryFrame=createSceneEntryFrame(rust),reference=createReferenceRoomMotion(motionKey);
 const room=new THREE.Object3D(),inverse=new Float64Array([0,0,0,1]),rows=[{left:0,right:600,bottom:300},{left:4,bottom:600},null];
 let entries=Array.from({length:12},()=>entry(next)),published=0,listed=0,gesture=false,rested=0;
 entryFrame.bind(entries,true);
 try{
  for(let tick=0;tick<700;tick++){
   const now=tick*1000/60;
   // Lifts and drags, a few entries at a time.
   for(const e of entries){
    const roll=next();
    if(roll<.02){e.bits=8;}else if(roll<.04){e.bits=6;e.dragNumberX=Math.round(next()*80-40);e.dragNumberY=-12;}
    else if(roll<.07){e.bits=0;e.dragNumberX=e.dragNumberY=0;}
    else if(e.bits&2&&roll<.5)e.dragNumberX+=next()<.5?1e-7:.75;
   }
   // Layouts: another order, fewer, more. A retained entry keeps its row's state.
   const layout=next();
   if(layout<.03){
    if(layout<.01)entries=entries.toReversed();
    else if(layout<.02)entries=entries.filter(()=>next()>.2);
    else entries=[...entries.slice(0,3),entry(next),...entries.slice(3),entry(next)];
    entryFrame.bind(entries,next()<.5);
   }
   // A book learns, changes or loses its shared identity; a stale local pose stays with its entry.
   if(next()<.03&&entries.length){
    const e=entries[Math.floor(next()*entries.length)];
    if(!e.kind){e.book=next()<.3?{}:{driveFileId:next()<.3?'shared':`g${tick}`};motionFrame.invalidate();}
   }
   if(next()<.02)rows[2]=rows[2]?null:{left:0,bottom:900};
   room.rotation.set(tick%120<60?.244:0,tick%120<60?-.524:0,0);room.updateMatrixWorld(true);
   sceneView.beginEntries(now,false,1,inverse,2,600,0,44);
   motionFrame.prepare(entries,rows,600,1000);
   entryFrame.refresh();
   entries.forEach((e,index)=>{
    const at=index*S,state=entryFrame.state,kind=e.kind==='plant'?1:e.kind==='lamp'?2:0;
    if(e.stale){e.stale=false;state[at]=kind;state[at+23]=e.x;state[at+24]=e.y;state[at+25]=e.width;state[at+26]=e.height;state[at+27]=e.depth;state[at+28]=e.depthInset;state.set(e.box,at+50);}
    state[at+2]=e.bits;state[at+3]=e.dragNumberX;state[at+4]=e.dragNumberY;state[at+85]=1;
   });
   if(tick%53===0)shelfWasm.memory.grow(1);
   entryFrame.poses(motionFrame.native,sceneView,roomMotion,roomTransition,now,gesture,room.matrixWorld);
   entries.forEach((e,index)=>reference.sample(e,motionFrame.key(index),entryFrame.output,index*ENTRY_OUTPUT));
   if(tick%59===0)shelfWasm.memory.grow(1);
   // The scene's publishRoomMotion: a gesture starts and ends at random; outside one, a quiet frame rests.
   if(!gesture&&next()<.06){gesture=true;reference.begin();entryFrame.motionBegin();}
   if(!gesture){if(next()<.4){reference.rest(entries);entryFrame.motionRest(motionFrame);rested++;}continue;}
   const end=next()<.08;
   if(!end&&next()<.5)continue;
   const expected=reference.poses(entries),actual=entryFrame.motionPoses(motionFrame);
   expect(plain(actual),`tick ${tick}`).toEqual(plain(expected));
   published++;listed+=actual.length;
   if(end){gesture=false;reference.rest(entries);entryFrame.motionRest(motionFrame);}
  }
  expect(published).toBeGreaterThan(40);expect(listed).toBeGreaterThan(100);expect(rested).toBeGreaterThan(40);
 }finally{entryFrame.free();motionFrame.free();sceneView.free();roomMotion.free();roomTransition.free();}
});
