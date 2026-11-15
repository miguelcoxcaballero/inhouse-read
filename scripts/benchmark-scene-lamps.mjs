// A frame's lamps: `previous` is 1.7.335, where the pose call knew nothing of them and JavaScript
// advanced each lamp's fade and tint object afterwards (tests/unit/helpers/reference-scene-lamp.js);
// `current` eases them inside the pose call, over 26 more columns of the entry arena, and reads one
// number per lamp. Both run the whole pose call, so the wider arena is paid for in the comparison;
// a room without lamps shows that cost alone. Node/WASM, no DOM or GPU. Interleaved rounds, medians.
// node scripts/benchmark-scene-lamps.mjs <dir of a 1.7.335 shelf build> <its src/js/scene-entry-frame.js> [dir with the current build]
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
import assert from 'node:assert/strict';
import {createLampReference} from '../tests/unit/helpers/reference-scene-lamp.js';
const load=async dir=>{const rust=await import(pathToFileURL(resolve(dir)+'/inhouse_read_shelf.js').href);rust.initSync({module:readFileSync(resolve(dir)+'/inhouse_read_shelf_bg.wasm')});return rust;};
const old=await load(process.argv[2]),rust=await load(process.argv[4]||'src/wasm/shelf');
const before=await import(pathToFileURL(resolve(process.argv[3])).href),after=await import('../src/js/scene-entry-frame.js');
const {createSceneMotionFrame}=await import('../src/js/scene-motion-frame.js');
const median=a=>a.toSorted((x,y)=>x-y)[Math.floor(a.length/2)];
const kelvins=[2200,2700,3000,4000,5000,6500],tints=new Map(kelvins.map((k,i)=>[k,k===2700?[1,1,1]:[1+i*.05,.9+i*.01,1.4-i*.13]]));
const rows=[{left:0,right:600,bottom:300,ceiling:10},{left:0,right:600,bottom:600,top:310},{left:0,right:600,bottom:900,ceiling:610}];
const room={elements:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]};
const setData=(node,key,value)=>{if(node.dataset[key]!==value)node.dataset[key]=value;};
function side(module,api,count,every){
 const scene=new module.RustScene(600,1200,600,250,false,true,0),roomMotion=new module.RustRoomMotion(),roomTransition=new module.RustRoomTransition();
 const motionFrame=createSceneMotionFrame(module,e=>e.kind?e.key:null),frame=api.createSceneEntryFrame(module),S=api.ENTRY_STATE;
 let calls=0;
 const entries=Array.from({length:count},(_,i)=>{const kind=every&&i%every===3?'lamp':undefined;
  return {kind,key:kind?`${kind}:${i}`:`book:${i}`,isOn:true,kelvin:2700,shelf:i%3,x:20+(i*37)%560,y:kind?255+(i%3)*300:200+(i%3)*300,width:kind?45:150,height:kind?90:200,depth:150,depthInset:0,
   bits:0,row:-1,node:{dataset:{}},model:{id:100+i,visible:true,userData:{overview:false,inspectionResolution:0,shownTint:'1,1,1',setPower(){calls++;},setTint(){calls++;}}},
   insertion:null,trashDrop:null,qualityReplacement:false,replacementReady:false,plantQuality:null,overview:false,inspectionResolution:0};});
 frame.bind(entries,true);
 if(frame.lamp)frame.lamp.lampTints([2700,...kelvins.flatMap(k=>[k,...tints.get(k)])],300);
 scene.sizeViewport(1400,1400,2,new Float64Array(4));scene.setInspection(1,0,0,false);
 frame.refresh();
 entries.forEach((e,index)=>{const at=index*S,state=frame.state;state[at]=e.kind==='lamp'?2:0;
  state[at+23]=e.x;state[at+24]=e.y;state[at+25]=e.width;state[at+26]=e.height;state[at+27]=e.depth;state.set([-14,-90,-7,14,110,7],at+50);
  if(frame.lamp&&e.kind==='lamp'){state[at+91]=1;state[at+92]=2700;}});
 frame.hold?.(entries);
 const lamps=entries.map((e,index)=>e.kind==='lamp'?index:-1).filter(index=>index>=0);
 let now=0;
 const begin=at=>{now=at;scene.beginEntries(now,false,1,new Float64Array([0,0,0,1]),2,600,0,44);motionFrame.prepare(entries,rows,600,1000);};
 const poses=()=>frame.poses(motionFrame.native,scene,roomMotion,roomTransition,now,false,room);
 return {entries,lamps,frame,S,begin,poses,now:()=>now,calls:()=>calls};
}
for(const [count,every] of [[40,10],[120,12],[300,12],[300,0]]){
 const a=side(old,before,count,every),b=side(rust,after,count,every);
 let dirty=0;
 const reference=createLampReference({scenePower:old.scene_lamp_power,tints,kelvins,defaultKelvin:2700,ms:300,setData,clock:()=>a.now()});
 const previous=()=>{
  a.poses();
  let moving=false;
  for(const index of a.lamps)moving=reference.advanceLampPower(a.entries[index],a.now(),false,()=>dirty++)||moving;
  return moving;
 };
 // The scene's own lines (src/js/bookshelf-scene.js updateEntries).
 const current=()=>{
  b.poses();
  let moving=false;
  for(const index of b.lamps){
   const entry=b.entries[index],row=index*b.S,node=entry.node;
   const lamps=b.frame.state,lit=lamps[row+116],power=lamps[row+94],model=entry.model;
   const tint=lit&4||entry.tinted!==model?[lamps[row+108],lamps[row+109],lamps[row+110]]:null;
   if(lit&2)dirty++;
   if(lit&24)moving=true;
   if(lit&1||entry.lit!==model){entry.lit=model;model?.userData.setPower?.(power);}
   if(node&&(lit&1||entry.litNode!==node)){entry.litNode=node;setData(node,'lampPower',power.toFixed(4));}
   if(model&&tint){
    entry.tinted=model;
    const text=tint.join();
    if(model.userData.shownTint!==text){model.userData.shownTint=text;model.userData.setTint?.(tint);dirty++;}
   }
  }
  return moving;
 };
 // The same answers first: at rest, then through a fade and a change of temperature.
 let clock=16;
 const both=()=>{a.begin(clock);b.begin(clock);assert.equal(current(),previous());clock+=16;};
 for(let frame=0;frame<5;frame++)both();
 for(const index of a.lamps){
  a.entries[index].isOn=false;a.entries[index].lampTint.set(4000,clock,true);a.entries[index].kelvin=4000;
  b.frame.refresh();b.frame.state[index*b.S+91]=0;b.entries[index].isOn=false;
  const real=globalThis.performance.now;globalThis.performance.now=()=>clock;b.frame.lamp.lampKelvin(index,b.entries[index].kelvin=4000,true);globalThis.performance.now=real;
 }
 for(let frame=0;frame<30;frame++)both();
 for(const index of a.lamps){
  assert.equal(a.entries[index].node.dataset.lampPower,b.entries[index].node.dataset.lampPower);
  assert.equal(a.entries[index].model.userData.shownTint,b.entries[index].model.userData.shownTint);
 }
 assert.equal(a.calls(),b.calls());
 const run=(label,step)=>{
  const olds=[],news=[];
  for(let round=0;round<25;round++){
   let t=performance.now();for(let i=0;i<4000;i++){step(a,i);previous();}olds.push((performance.now()-t)/4000*1000);
   t=performance.now();for(let i=0;i<4000;i++){step(b,i);current();}news.push((performance.now()-t)/4000*1000);
  }
  console.log(`${count} entries, ${a.lamps.length} lamps, ${label}: ${median(olds).toFixed(2)} -> ${median(news).toFixed(2)} us per frame (x${(median(olds)/median(news)).toFixed(2)})`);
 };
 a.begin(clock);b.begin(clock);
 run('at rest',()=>{});
 if(!a.lamps.length)continue;
 // Every lamp switched every twelfth frame: each frame eases every fade (the worst case).
 let flips=[clock,clock];
 run('every lamp fading',(s,i)=>{
  const which=s===a?0:1;flips[which]+=16;
  if(i%12===0)for(const index of s.lamps){const entry=s.entries[index];entry.isOn=!entry.isOn;if(s===b)s.frame.state[index*s.S+91]=entry.isOn?1:0;}
  s.begin(flips[which]);
 });
 a.begin(clock);b.begin(clock);
}
