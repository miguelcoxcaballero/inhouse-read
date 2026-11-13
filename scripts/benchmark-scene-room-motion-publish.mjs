// The shared room's local motion per frame: the frozen host bookkeeping (a pose array per keyed
// entry per frame, the map of poses at rest rebuilt in every quiet frame, the moved keys and
// their rows in a gesture: tests/unit/helpers/reference-room-motion-publish.js) against the same
// kept in the entry arena (src/js/scene-entry-frame.js motionRest / motionBegin / motionPoses).
// Both sides run the same entry frame (state written, one native pose call) on their own
// arenas; the published rows are asserted equal first.
// Node/WASM, no DOM, GPU or battery measurement. Interleaved rounds, medians.
// node scripts/benchmark-scene-room-motion-publish.mjs [dir with inhouse_read_shelf.js + _bg.wasm]
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
import assert from 'node:assert/strict';
import * as THREE from 'three';
const dir=resolve(process.argv[2]||'src/wasm/shelf');
const rust=await import(pathToFileURL(dir+'/inhouse_read_shelf.js').href);
rust.initSync({module:readFileSync(dir+'/inhouse_read_shelf_bg.wasm')});
const {createSceneMotionFrame}=await import('../src/js/scene-motion-frame.js');
const {createSceneEntryFrame,ENTRY_STATE:S,ENTRY_OUTPUT}=await import('../src/js/scene-entry-frame.js');
const {createReferenceRoomMotion}=await import('../tests/unit/helpers/reference-room-motion-publish.js');
const median=a=>a.toSorted((x,y)=>x-y)[Math.floor(a.length/2)],results=[];
const motionKey=e=>e.kind==='lamp'?e.key:e.book?.driveFileId?`book:drive:${e.book.driveFileId}`:null;
const perShelf=28,width=perShelf*21+20;
function side(count){
 const entries=Array.from({length:count},(_,i)=>{const lamp=i%23===7,shelf=Math.floor(i/perShelf),slot=i%perShelf;
  return {kind:lamp?'lamp':undefined,key:lamp?`lamp:${i}`:`book:${i}`,book:lamp?undefined:{driveFileId:`f${i}`},shelf,x:20+slot*21,y:200+shelf*300,width:lamp?40:150,height:lamp?12:200,
   depth:150,depthInset:0,box:Float64Array.of(-9,-100,-75,9,100,75),bits:0,dragNumberX:0,dragNumberY:0,row:-1,stale:true};});
 const c={entries,sceneView:new rust.RustScene(width,1200,width,250,false,false,0),roomMotion:new rust.RustRoomMotion(),roomTransition:new rust.RustRoomTransition(),
  motionFrame:createSceneMotionFrame(rust,motionKey),entryFrame:createSceneEntryFrame(rust),reference:createReferenceRoomMotion(motionKey),sink:0,last:null};
 c.entryFrame.bind(entries,true);return c;
}
const room=new THREE.Object3D(),inverse=new Float64Array([0,0,0,1]);room.updateMatrixWorld(true);
function frame(c,tick,bays,arranging){
 const {entries,entryFrame}=c,now=tick*16;
 c.sceneView.beginEntries(now,false,1,inverse,2,width,0,44);c.motionFrame.prepare(entries,bays,width,1000);
 entryFrame.refresh();
 for(let index=0;index<entries.length;index++){
  const e=entries[index],at=index*S,state=entryFrame.state,kind=e.kind==='lamp'?2:0;
  if(e.stale){e.stale=false;state[at]=kind;state[at+23]=e.x;state[at+24]=e.y;state[at+25]=e.width;state[at+26]=e.height;state[at+27]=e.depth;state[at+28]=e.depthInset;state.set(e.box,at+50);}
  state[at+2]=e.bits;state[at+3]=e.dragNumberX;state[at+4]=e.dragNumberY;state[at+49]=4;
 }
 c.sink+=entryFrame.poses(c.motionFrame.native,c.sceneView,c.roomMotion,c.roomTransition,now,arranging,room.matrixWorld);
}
// `quiet`: no gesture; every frame is quiet, as while the page scrolls. `one dragged`: an
// arrangement in which one book is dragged, published every third frame (the 50 ms throttle at
// 60 Hz). `all moved`: an arrangement in which every entry is lifted, so every row is published.
for(const count of [40,120,300])for(const mode of ['quiet','one dragged','all moved']){
 const o=side(count),n=side(count),bays=Array.from({length:Math.ceil(count/perShelf)},(_,shelf)=>({left:0,right:width,bottom:300+shelf*300}));
 const gesture=mode!=='quiet';
 const events=(c,tick)=>{
  if(mode==='one dragged'){const e=c.entries[1];e.bits=6;e.dragNumberX=Math.sin(tick*.05)*40;e.dragNumberY=-14;}
  if(mode==='all moved')for(const e of c.entries)e.bits=Math.floor(tick/12)%2?8:0;
 };
 const previous=tick=>{
  events(o,tick);frame(o,tick,bays,gesture);
  const {entries,entryFrame,motionFrame,reference}=o;entryFrame.refresh();
  for(let index=0;index<entries.length;index++)reference.sample(entries[index],motionFrame.key(index),entryFrame.output,index*ENTRY_OUTPUT);
  if(!gesture){reference.rest(entries);return;}
  if(tick%3===0){o.last=reference.poses(entries);o.sink+=o.last.length;}
 };
 const current=tick=>{
  events(n,tick);frame(n,tick,bays,gesture);
  if(!gesture){n.entryFrame.motionRest(n.motionFrame);return;}
  if(tick%3===0){n.last=n.entryFrame.motionPoses(n.motionFrame);n.sink+=n.last.length;}
 };
 try{
  let clock=0;
  // Three quiet frames first, so both sides hold the poses at rest before a gesture.
  for(;clock<3;clock++){frame(o,clock,bays,false);frame(n,clock,bays,false);o.entryFrame.refresh();
   o.entries.forEach((e,index)=>o.reference.sample(e,o.motionFrame.key(index),o.entryFrame.output,index*ENTRY_OUTPUT));
   o.reference.rest(o.entries);n.entryFrame.motionRest(n.motionFrame);}
  o.reference.begin();n.entryFrame.motionBegin();
  for(;clock<120;clock++){previous(clock);current(clock);assert.deepStrictEqual(n.last,o.last,`${mode} ${count} tick ${clock}`);}
  if(mode==='one dragged')assert.equal(n.last.length,1);
  if(mode==='all moved')assert.equal(n.last.length,count);
  const loops=120;let oldTick=clock,newTick=clock;
  const timeOld=()=>{const start=performance.now();for(let i=0;i<loops;i++)previous(oldTick++);return(performance.now()-start)/loops;};
  const timeNew=()=>{const start=performance.now();for(let i=0;i<loops;i++)current(newTick++);return(performance.now()-start)/loops;};
  const old=[],now=[];
  for(let round=0;round<21;round++){if(round%2){now.push(timeNew());old.push(timeOld());}else{old.push(timeOld());now.push(timeNew());}}
  results.push({count,mode,hostMs:+median(old).toFixed(4),arenaMs:+median(now).toFixed(4),speedup:+(median(old)/median(now)).toFixed(2),sink:Number.isFinite(o.sink+n.sink)});
 }finally{for(const c of [o,n]){c.entryFrame.free();c.motionFrame.free();c.sceneView.free();c.roomMotion.free();c.roomTransition.free();}}
}
console.log(JSON.stringify({date:new Date().toISOString(),scope:'entry frame (state, native poses) plus the shared room\'s local motion bookkeeping, per frame, Node/WASM',results},null,1));
