// The scene's entry stage per frame: the frozen host path (entry objects marshalled into the
// solver or a step packet, read back, composed by three and written into the entry frame:
// tests/unit/helpers/reference-scene-entry-marshal.js) against the entries' state kept in the
// entry arena and one native call (src/js/scene-entry-frame.js), with the host's side of each
// as bookshelf-scene.js runs it. Same inputs; without rigid bodies the output arenas are asserted
// bit-equal first.
// Node/WASM, no DOM, GPU or battery measurement. Interleaved rounds, medians.
// node scripts/benchmark-scene-entry-state.mjs [dir with inhouse_read_shelf.js + _bg.wasm]
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
const {createGravityFrame}=await import('../src/js/gravity-frame.js');
const {createGravityFrame:referenceGravityFrame}=await import('../tests/unit/helpers/reference-gravity-frame.js');
const {createMarshalFrame}=await import('../tests/unit/helpers/reference-scene-entry-marshal.js');
const median=a=>a.toSorted((x,y)=>x-y)[Math.floor(a.length/2)],results=[];
const key=e=>e.kind==='lamp'?e.key:e.book?.driveFileId?`book:drive:${e.book.driveFileId}`:null;
const perShelf=28,width=perShelf*21+20,pixelsPerMetre=1000;
function data(i){
 const lamp=i%23===7,shelf=Math.floor(i/perShelf),slot=i%perShelf;
 return {kind:lamp?'lamp':undefined,mount:lamp?'undershelf':undefined,key:lamp?`lamp:${i}`:`book:${i}`,book:lamp?undefined:i%3?{}:{driveFileId:`f${i}`},shelf,
  x:20+slot*21,y:200+shelf*300,width:lamp?40:150,height:lamp?12:200,depth:150,depthInset:0,thickness:18,gripHeight:0,
  box:Float64Array.of(-9,-100,-75,9,100,75),bits:0,dragNumberX:0,dragNumberY:0,model:{},overview:false,trashDrop:null,insertion:null};
}
const oldEntry=d=>({...d,pose:new THREE.Object3D(),lift:{value:0,from:0,target:0,started:0},landing:null,offset:{x:0,y:0},
 preview:{x:0,y:0,fromX:0,fromY:0,targetX:0,targetY:0,started:0,active:false},lean:undefined});
const newEntry=d=>({...d,pose:new THREE.Object3D(),row:-1,stale:true,lean:undefined});
function arenaFrame(frame,gravityFrame,motionFrame,entries,c){
 if(c.usePhysics)gravityFrame.prepare(entries);
 frame.refresh();
 for(let index=0;index<entries.length;index++){
  const e=entries[index],at=index*S,state=frame.state;
  const lamp=e.kind==='lamp',undershelf=lamp&&e.mount==='undershelf',kind=lamp?2:0;
  if(e.stale){e.stale=false;state[at]=kind;state[at+1]=undershelf?1:0;
   state[at+23]=e.x;state[at+24]=e.y;state[at+25]=e.width;state[at+26]=e.height;state[at+27]=e.depth;state[at+28]=e.depthInset;state.set(e.box,at+50);}
  state[at+2]=e.bits;state[at+3]=e.dragNumberX;state[at+4]=e.dragNumberY;
  if(c.usePhysics){
   const row=c.rows[e.shelf||0]||c.rows[0]||{};
   state[at+40]=kind?e.width:e.thickness;state[at+41]=undershelf?3:kind;state[at+42]=e.shelf||0;state[at+43]=c.pixelsPerMetre;
   state[at+44]=row.left||0;state[at+45]=row.right??c.width;state[at+46]=row.bottom??e.y+e.height/2;state[at+47]=row.ceiling??row.top??0;state[at+48]=e.gripHeight||0;
  }
  state[at+49]=(e.trashDrop?1:0)|(e.insertion?2:0)|(e.model?4:0)|(e.overview?8:0)|(e.trashDrop?.complete?16:0)|(e.insertion?.overlayCanvas?32:0);
 }
 const summary=c.usePhysics?frame.settled(gravityFrame.native,c.bookGravity,motionFrame.native,c.sceneView,c.roomMotion,c.roomTransition,c.now,c.reduced,c.arranging,c.room)
  :frame.poses(motionFrame.native,c.sceneView,c.roomMotion,c.roomTransition,c.now,c.arranging,c.room);
 for(let index=0;index<entries.length;index++){
  const e=entries[index],pose=e.pose,decorative=e.kind==='lamp';
  frame.refresh();
  const live=frame.output,at=index*ENTRY_OUTPUT,liveFlags=live[at],state=frame.state,row=index*S,changed=state[row+70];
  if(changed&1){pose.position.set(state[row+29],state[row+30],state[row+31]);
   pose.rotation.set(state[row+32],state[row+33],state[row+34],state[row+56]?'ZYX':'XYZ');pose.scale.setScalar(state[row+35]);}
  if(c.usePhysics&&!decorative)c.leanOf(e,state[row+69]);
  if(liveFlags&2){pose.position.set(live[at+10],live[at+11],live[at+12]);pose.quaternion.set(live[at+13],live[at+14],live[at+15],live[at+16]);pose.scale.setScalar(live[at+17]);}
  if(liveFlags&4){pose.position.set(live[at+18],live[at+19],live[at+20]);pose.quaternion.set(live[at+21],live[at+22],live[at+23],live[at+24]);pose.scale.setScalar(live[at+25]);}
  if(changed&2){pose.matrix.fromArray(live,at+26);pose.matrixWorldNeedsUpdate=true;}
 }
 return {moving:Boolean(summary&1),shelfMoving:Boolean(summary&2),previewing:Boolean(summary&4),previewed:Math.floor(summary/8)};
}
// `resting`: nothing changes. `lifting`: every fourth entry is pressed and released in turn, so
// its lift eases in most frames. `dragging` (rigid bodies): one book is dragged along its shelf.
for(const count of [40,120,300])for(const [usePhysics,mode] of [[false,'resting'],[false,'lifting'],[true,'resting'],[true,'dragging']]){
 const sides=[0,1].map(()=>({sceneView:new rust.RustScene(width,1200,width,250,false,false,0),bookGravity:new rust.RustBookGravity(),
  roomMotion:new rust.RustRoomMotion(),roomTransition:new rust.RustRoomTransition(),motionFrame:createSceneMotionFrame(rust,key),entryFrame:createSceneEntryFrame(rust)}));
 const [o,n]=sides,oldGravity=referenceGravityFrame(rust),gravityFrame=createGravityFrame(rust);
 const marshal=createMarshalFrame({gravityFrame:oldGravity,entryFrame:o.entryFrame,motionFrame:o.motionFrame});
 const room=new THREE.Object3D(),inverse=new Float64Array([0,0,0,1]);room.updateMatrixWorld(true);
 const rows=Array.from({length:Math.ceil(count/perShelf)},(_,shelf)=>({left:0,right:width,bottom:300+shelf*300,ceiling:10+shelf*300}));
 const ds=Array.from({length:count},(_,i)=>data(i)),olds=ds.map(oldEntry),news=ds.map(newEntry);
 n.entryFrame.bind(news,true);
 let sink=0,clock=0;
 const context=(side,now)=>({usePhysics,bookGravity:side.bookGravity,sceneView:side.sceneView,roomMotion:side.roomMotion,roomTransition:side.roomTransition,
  now,reduced:false,arranging:false,rows,width,pixelsPerMetre,room:room.matrixWorld,leanOf:(e,value)=>{e.lean=value;}});
 function events(entries,tick){
  if(mode==='lifting')for(let i=0;i<count;i+=4)entries[i].bits=Math.floor((tick+i)/12)%2?8:0;
  if(mode==='dragging'){const e=entries[1];e.bits=6;e.dragNumberX=Math.sin(tick*.05)*40;e.dragNumberY=-14;}
 }
 function begin(side,entries,now){side.sceneView.beginEntries(now,false,1,inverse,2,width,0,44);side.motionFrame.prepare(entries,rows,width,pixelsPerMetre);}
 const previous=tick=>{const now=tick*16;events(olds,tick);begin(o,olds,now);sink+=marshal(olds,context(o,now)).previewed;};
 const current=tick=>{const now=tick*16;events(news,tick);begin(n,news,now);sink+=arenaFrame(n.entryFrame,gravityFrame,n.motionFrame,news,context(n,now)).previewed;};
 try{
  // The rigid bodies' first step warms up against an 80 ms wall clock (book_gravity.rs), so two
  // solvers of a large shelf need not agree bit for bit; their identity is held by the smaller
  // tests/unit/scene-entry-state-wasm.test.js. Without rigid bodies every frame is compared here.
  for(;clock<90;clock++){previous(clock);current(clock);o.entryFrame.refresh();n.entryFrame.refresh();
   if(usePhysics)continue;
   const a=o.entryFrame.output,b=n.entryFrame.output;
   for(let k=0;k<a.length;k++)assert.ok(Object.is(a[k],b[k]),`${mode} tick ${clock} entry ${Math.floor(k/ENTRY_OUTPUT)} value ${k%ENTRY_OUTPUT}: ${a[k]} vs ${b[k]}`);}
  // Each side keeps its own clock position: both run the same ticks, in interleaved rounds.
  const loops=usePhysics?30:120;
  let oldTick=clock,newTick=clock;
  const timeOld=()=>{const start=performance.now();for(let i=0;i<loops;i++)previous(oldTick++);return(performance.now()-start)/loops;};
  const timeNew=()=>{const start=performance.now();for(let i=0;i<loops;i++)current(newTick++);return(performance.now()-start)/loops;};
  const old=[],arena=[];
  for(let round=0;round<21;round++){if(round%2){arena.push(timeNew());old.push(timeOld());}else{old.push(timeOld());arena.push(timeNew());}}
  results.push({count,rigidBodies:usePhysics,mode,marshalledMs:+median(old).toFixed(4),arenaMs:+median(arena).toFixed(4),speedup:+(median(old)/median(arena)).toFixed(2),sink:Number.isFinite(sink)});
 }finally{
  oldGravity.free();gravityFrame.free();
  for(const side of sides){side.entryFrame.free();side.motionFrame.free();side.sceneView.free();side.bookGravity.free();side.roomMotion.free();side.roomTransition.free();}
 }
}
console.log(JSON.stringify({date:new Date().toISOString(),scope:'scene entry stage per frame (state, pose, room, projection), Node/WASM, shared host',results},null,1));
