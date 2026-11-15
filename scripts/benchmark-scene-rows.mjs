// What moved into rust-ui/src/scene_rows.rs, against 1.7.338: `previous` is the 1.7.338 build and its
// host code (tests/unit/helpers/reference-scene-rows.js), `current` the present build and the
// scene's own lines.
//  - a frame at rest: the pose call, then the room's epoch (formerly sixteen copies and a bit
//    comparison in JavaScript after the call, now part of the call and two reads);
//  - a frame of a reorder: each item's offset written by the host before the pose call, or by the call;
//  - the per-frame check of every standing decoration's stamp, against a flag set by events (JavaScript both);
//  - a layout's rebinding of the arena's rows (cold).
// Node/WASM, no DOM or GPU. Interleaved rounds, medians.
// node scripts/benchmark-scene-rows.mjs <dir of a 1.7.338 shelf build> <its src/js/scene-entry-frame.js> [dir with the current build]
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
import assert from 'node:assert/strict';
import {referenceReorderStep,createReferenceRoomEpoch,referenceStamped} from '../tests/unit/helpers/reference-scene-rows.js';
const load=async dir=>{const rust=await import(pathToFileURL(resolve(dir)+'/inhouse_read_shelf.js').href);rust.initSync({module:readFileSync(resolve(dir)+'/inhouse_read_shelf_bg.wasm')});return rust;};
const old=await load(process.argv[2]),rust=await load(process.argv[4]||'src/wasm/shelf');
const before=await import(pathToFileURL(resolve(process.argv[3])).href),after=await import('../src/js/scene-entry-frame.js');
const {createSceneMotionFrame}=await import('../tests/unit/helpers/scene-motion-frame.js');
const median=a=>a.toSorted((x,y)=>x-y)[Math.floor(a.length/2)];
const rows=[{left:0,right:600,bottom:300,ceiling:10},{left:0,right:600,bottom:600,top:310},{left:0,right:600,bottom:900,ceiling:610}];
const room={elements:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]};
function side(module,api,count){
 const scene=new module.RustScene(600,1200,600,250,false,true,0),roomMotion=new module.RustRoomMotion(),roomTransition=new module.RustRoomTransition();
 const motionFrame=createSceneMotionFrame(module,e=>e.kind?e.key:null),frame=api.createSceneEntryFrame(module),S=api.ENTRY_STATE;
 const entries=Array.from({length:count},(_,i)=>{const kind=i%12===3?'lamp':i%12===7?'plant':undefined;
  return {kind,key:kind?`${kind}:${i}`:`book:${i}`,isOn:true,kelvin:2700,shelf:i%3,x:20+(i*37)%560,y:kind?255+(i%3)*300:200+(i%3)*300,width:kind?45:150,height:kind?90:200,depth:150,depthInset:0,
   catalogId:'monstera',variant:0,potId:'muskot',lampId:'tripod',stale:false,solid:true,collisionStamp:null,
   bits:0,row:-1,model:{id:100+i,visible:true,userData:{overview:false,inspectionResolution:0}},
   insertion:null,trashDrop:null,qualityReplacement:false,replacementReady:false,plantQuality:null,overview:false,inspectionResolution:0};});
 frame.bind(entries,true);
 frame.lamp.lampTints([2700,2700,1,1,1],300);
 scene.sizeViewport(1400,1400,2,new Float64Array(4));scene.setInspection(1,0,0,false);
 frame.refresh();
 entries.forEach((e,index)=>{const at=index*S,state=frame.state;state[at]=e.kind==='lamp'?2:e.kind==='plant'?1:0;
  state[at+23]=e.x;state[at+24]=e.y;state[at+25]=e.width;state[at+26]=e.height;state[at+27]=e.depth;state.set([-14,-90,-7,14,110,7],at+50);
  if(e.kind==='lamp'){state[at+91]=1;state[at+92]=2700;}});
 frame.hold(entries);
 let now=0;
 const begin=at=>{now=at;scene.beginEntries(now,false,1,new Float64Array([0,0,0,1]),2,600,0,44);motionFrame.prepare(entries,rows,600,1000);};
 const poses=()=>frame.poses(motionFrame.native,scene,roomMotion,roomTransition,now,false,room);
 return {entries,frame,scene,S,begin,poses};
}
const rounds=(label,unit,times,previous,current)=>{
 const olds=[],news=[];
 for(let round=0;round<25;round++){
  let t=performance.now();for(let i=0;i<times;i++)previous(i);olds.push((performance.now()-t)/times*1000);
  t=performance.now();for(let i=0;i<times;i++)current(i);news.push((performance.now()-t)/times*1000);
 }
 console.log(`${label}: ${median(olds).toFixed(3)} -> ${median(news).toFixed(3)} ${unit} (x${(median(olds)/median(news)).toFixed(2)})`);
};
let sink=0;
for(const count of [40,120,300]){
 const a=side(old,before,count),b=side(rust,after,count);
 const epochOf=createReferenceRoomEpoch();
 // The scene's own lines (src/js/bookshelf-scene.js draw and updateEntries).
 const previousFrame=()=>{a.poses();const walked=epochOf(room.elements);sink+=walked[0];return walked;};
 const currentFrame=()=>{b.poses();b.frame.refresh();const epoch=b.frame.walk[0],roomMoved=b.frame.walk[1]===1;sink+=epoch;return [epoch,roomMoved];};
 a.begin(16);b.begin(16);
 for(let frame=0;frame<5;frame++){room.elements[12]=frame<3?frame:2;assert.deepEqual(currentFrame(),previousFrame());}
 rounds(`${count} entries, a frame at rest (pose call and the room's epoch)`,'us per frame',4000,previousFrame,currentFrame);
 // A reorder: a third of the entries ease from where they stood.
 const itemsA=[],flat=[];
 a.entries.forEach((entry,index)=>{if(index%3===0){itemsA.push({entry,x:index-20.5,y:7.25});flat.push(b.entries[index].row,index-20.5,7.25);}});
 // Begun again every thirty frames, before its 520 ms end: the items stay on both sides.
 b.frame.lamp.reorder(flat);
 let clockA=1000,clockB=1000;
 const reorderPrevious=i=>{
  if(i%30===0)a.scene.beginReorder(clockA);
  clockA+=16;const begun=a.scene.beginFrame(clockA);
  if(begun&2){a.frame.refresh();referenceReorderStep(a.frame.state,itemsA,a.scene.reorderLeft,false,a.S);}
  a.begin(clockA);a.poses();
 };
 const reorderCurrent=i=>{
  if(i%30===0)b.scene.beginReorder(clockB);
  clockB+=16;b.scene.beginFrame(clockB);
  b.begin(clockB);b.poses();
 };
 for(let i=0;i<90;i++){reorderPrevious(i);reorderCurrent(i);a.frame.refresh();b.frame.refresh();
  for(let index=0;index<count;index++)assert.ok(Object.is(a.frame.state[index*a.S+21],b.frame.state[index*b.S+21])&&Object.is(a.frame.state[index*a.S+22],b.frame.state[index*b.S+22]));}
 rounds(`${count} entries, a frame of a reorder (${itemsA.length} items, pose call included)`,'us per frame',3000,reorderPrevious,reorderCurrent);
 // The standing decorations' solids: the stamp compared in every frame, or a flag set by events.
 const decor=a.entries.filter(entry=>entry.kind);
 for(const entry of decor)referenceStamped(entry,1000);
 const stampPrevious=()=>{for(const entry of a.entries){const plant=entry.kind==='plant',lamp=entry.kind==='lamp',undershelf=lamp&&entry.mount==='undershelf';
  if((plant||lamp)&&!undershelf&&referenceStamped(entry,1000))sink++;}};
 let staticStale=false;
 const stampCurrent=()=>{for(const entry of b.entries){const plant=entry.kind==='plant',lamp=entry.kind==='lamp',undershelf=lamp&&entry.mount==='undershelf';
  const stale=staticStale||entry.stale;if(stale)entry.solid=false;
  if((plant||lamp)&&!undershelf&&!entry.solid){entry.solid=true;sink++;}}};
 rounds(`${count} entries, ${decor.length} decorations, the solids' check of a frame at rest`,'us per frame',20000,stampPrevious,stampCurrent);
 // A layout: the same entries in reverse order.
 rounds(`${count} entries, a layout's rebinding (cold)`,'us',300,()=>{a.entries.reverse();a.frame.bind(a.entries,true);},()=>{b.entries.reverse();b.frame.bind(b.entries,true);});
}
console.log(sink>0?'':'');
