// What a frame asks about what its entries hold, with nothing changing between frames (a room
// that scrolls, zooms or has one book in the air): `previous` is 1.7.330, where every frame walked
// the entries twice in JavaScript (settledQualityWork for each settled entry, then the census'
// three numbers per entry); `current` tells the arena only after a change, decides the settled
// entries' quality in the pose call and takes the census from the arena. Both run the whole pose
// call, so what is compared is poses + quality decisions + census (and the last two alone, over the
// poses already taken). Node/WASM, no DOM or GPU.
// Interleaved rounds, medians.
// node scripts/benchmark-scene-held.mjs <dir of a 1.7.330 shelf build> <its src/js/scene-entry-frame.js> [dir with the current build]
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
import assert from 'node:assert/strict';
const load=async dir=>{const rust=await import(pathToFileURL(resolve(dir)+'/inhouse_read_shelf.js').href);rust.initSync({module:readFileSync(resolve(dir)+'/inhouse_read_shelf_bg.wasm')});return rust;};
const old=await load(process.argv[2]),rust=await load(process.argv[4]||'src/wasm/shelf');
const before=await import(pathToFileURL(resolve(process.argv[3])).href),after=await import('../src/js/scene-entry-frame.js');
const {createSceneMotionFrame}=await import('../src/js/scene-motion-frame.js');
const median=a=>a.toSorted((x,y)=>x-y)[Math.floor(a.length/2)];
const rows=[{left:0,right:600,bottom:300,ceiling:10},{left:0,right:600,bottom:600,top:310},{left:0,right:600,bottom:900,ceiling:610}];
const room={elements:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]};
function side(module,api,count){
 const scene=new module.RustScene(600,1200,600,250,false,true,0),roomMotion=new module.RustRoomMotion(),roomTransition=new module.RustRoomTransition();
 const motionFrame=createSceneMotionFrame(module,e=>e.kind?e.key:null),frame=api.createSceneEntryFrame(module),S=api.ENTRY_STATE,O=api.ENTRY_OUTPUT;
 const entries=Array.from({length:count},(_,i)=>{const kind=i%19===11?'plant':i%23===7?'lamp':undefined;
  return {kind,key:kind?`${kind}:${i}`:`book:${i}`,shelf:i%3,x:20+(i*37)%560,y:kind?255+(i%3)*300:200+(i%3)*300,width:kind?45:150,height:kind?90:200,depth:150,depthInset:0,
   bits:0,row:-1,model:{id:100+i,visible:true,userData:{overview:false,inspectionResolution:0}},insertion:null,trashDrop:null,qualityReplacement:false,replacementReady:false,plantQuality:null,
   overview:false,inspectionResolution:0};});
 frame.bind(entries,true);
 scene.sizeViewport(1400,1400,2,new Float64Array(4));scene.setInspection(1,0,0,false);
 frame.refresh();
 entries.forEach((e,index)=>{const at=index*S,state=frame.state;state[at]=e.kind==='plant'?1:e.kind==='lamp'?2:0;
  state[at+23]=e.x;state[at+24]=e.y;state[at+25]=e.width;state[at+26]=e.height;state[at+27]=e.depth;state.set([-14,-90,-7,14,110,7],at+50);state[at+49]=4;});
 let now=0,calls=0,applied=0;
 const begin=()=>{now+=16;scene.beginEntries(now,false,1,new Float64Array([0,0,0,1]),2,600,0,44);motionFrame.prepare(entries,rows,600,1000);};
 const poses=()=>frame.poses(motionFrame.native,scene,roomMotion,roomTransition,now,false,room);
 return {entries,frame,S,O,begin,poses,scene,stats:()=>[calls,applied],call(entry,overview,resolution){calls++;entry.overview=overview;entry.inspectionResolution=resolution;},applies(){applied++;}};
}
for(const count of [40,120,300]){
 const a=side(old,before,count),b=side(rust,after,count);
 const previous=posing=>{
  if(posing)a.poses();
  const live=a.frame.output;
  for(let index=0,at=0;index<count;index++,at+=a.O)if(live[at+66]===1){
   a.applies();
   const entry=a.entries[index],overview=live[at+67]===1,resolution=live[at+68];
   if(before.settledQualityWork(entry,overview,resolution))a.call(entry,overview,resolution);
  }
  return a.frame.census(a.entries,true);
 };
 let stale=true;
 const current=posing=>{
  if(stale){stale=false;b.frame.hold(b.entries);}
  if(posing)b.poses();
  const live=b.frame.output,state=b.frame.state;
  for(let index=0,at=0,row=70;index<count;index++,at+=b.O,row+=b.S)if(state[row]&8){stale=true;b.call(b.entries[index],live[at+67]===1,live[at+68]);}
  if(stale){stale=false;b.frame.hold(b.entries);}
  return b.frame.census(true);
 };
 // The same answers first, then a room at rest.
 for(let frame=0;frame<5;frame++){a.begin();b.begin();assert.equal(current(true),previous(true));assert.deepEqual(Array.from(b.frame.counts),Array.from(a.frame.counts));}
 assert.ok(a.stats()[1]>count*3,'the entries are settled and visible');
 a.begin();b.begin();
 for(const posing of [true,false]){
  const olds=[],news=[];
  for(let round=0;round<25;round++){
   let t=performance.now();for(let i=0;i<4000;i++)previous(posing);olds.push((performance.now()-t)/4000*1000);
   t=performance.now();for(let i=0;i<4000;i++)current(posing);news.push((performance.now()-t)/4000*1000);
  }
  console.log(`${count} entries, ${posing?'poses + quality decisions + census':'quality decisions + census alone'}: ${median(olds).toFixed(2)} -> ${median(news).toFixed(2)} us per frame (x${(median(olds)/median(news)).toFixed(2)})`);
 }
}
