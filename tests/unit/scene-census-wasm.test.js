// @vitest-environment node
import {expect,it} from 'vitest';
import {rustShelf as rust} from './helpers/rust-shelf-ready.js';
import {createSceneEntryFrame,ENTRY_STATE as S} from '../../src/js/scene-entry-frame.js';
import {referenceCounts,referenceCasters,referenceOverlay,referenceNative,referenceTouched,referenceBusy,referencePaintedAway} from './helpers/reference-scene-census.js';

// The frame's questions about its entries (counts, casters, loading, overlay and native insertion,
// busy, touched, painted away, the quality hold) are answered by one census of the entry arena
// (rust-ui/src/scene_census.rs). The frozen per-entry JavaScript (helpers/reference-scene-census.js)
// and the former object-reading scene_quality_hold must answer the same over random rooms.
let seed=7;
const random=()=>(seed=Math.imul(seed,1664525)+1013904223>>>0)/4294967296,chance=p=>random()<p;
const pick=list=>list[Math.floor(random()*list.length)];
let ids=1;
function entry(){
 const kind=pick(['book','book','book','plant','lamp',undefined]);
 const model=chance(.8)?{id:chance(.02)?2**31+ids++:ids++,visible:chance(.7),userData:{overview:pick([true,false,undefined,1,0]),
  inspectionResolution:pick([undefined,0,-0,512,1024,2048,NaN,Infinity])}}:null;
 const insertion=chance(.08)?{overlayCanvas:chance(.5)?{}:null,nativePresentation:chance(.3)?{}:null,complete:chance(.5)}:null;
 const bits=Math.floor(random()*16);
 return {kind,model,insertion,trashDrop:chance(.05)?{complete:chance(.5)}:null,
  qualityReplacement:chance(.15),replacementReady:chance(.5),plantQuality:chance(.1)?{ready:chance(.5)}:null,
  bits,flags:{away:Boolean(bits&1),pressed:Boolean(bits&8)},row:-1,
  lift:pick([0,0,0,-0,.22,1,NaN]),landing:pick([0,0,0,1]),preview:pick([0,0,0,1])};
}
function write(frame,entries){
 frame.refresh();
 entries.forEach((e,index)=>{const at=index*S,state=frame.state;
  state[at]=e.kind==='plant'?1:e.kind==='lamp'?2:0;state[at+2]=e.bits;state[at+5]=e.lift;state[at+9]=e.landing;state[at+20]=e.preview;});
}
const flags=(entries,frame)=>({
 loading:entries.some(e=>Boolean(e.qualityReplacement&&!e.replacementReady||e.plantQuality&&!e.plantQuality.ready)),
 overlay:referenceOverlay(entries),native:referenceNative(entries),
 busy:referenceBusy(entries,e=>{const at=e.row*S;return frame.state[at+9]!==0||frame.state[at+20]!==0;}),
 touched:referenceTouched(entries,e=>frame.state[e.row*S+5])});

it('answers what the frozen per-entry scans answered, over random rooms and layouts',()=>{
 const frame=createSceneEntryFrame(rust),painted=new Set();
 let entries=[],lastText=null,rebuilt=0;
 try{
  for(let round=0;round<600;round++){
   if(round%7===0){
    // A layout: some entries stay (in another order), some go, some arrive.
    entries=[...entries.filter(()=>chance(.7)).sort(()=>random()-.5),...Array.from({length:Math.floor(random()*9)},entry)];
    if(round%91===0)entries=[];
    frame.bind(entries,false);
   }else for(const e of entries)if(chance(.25))Object.assign(e,entry(),{row:e.row});
   write(frame,entries);
   const trash=chance(.5),held=frame.census(entries,trash),expected=flags(entries,frame);
   expect({loading:Boolean(held&2),overlay:Boolean(held&4),native:Boolean(held&8),busy:Boolean(held&16),touched:Boolean(held&32)}).toEqual(expected);
   expect(frame.counts[0]).toBe(referenceCasters(entries,trash));
   const counts=new Float64Array(8),text=referenceCounts(rust.scene_counts,entries,counts);
   expect(frame.resolutions).toBe(text);
   expect(Array.from(frame.counts.subarray(1))).toEqual(Array.from(counts));
   // The text is rebuilt only when a counted number differs.
   if(held&1)rebuilt++;else expect(frame.resolutions).toBe(lastText);
   lastText=frame.resolutions;
   expect(frame.census(entries,trash)&1).toBe(0);
   if(chance(.4)){frame.painted();referencePaintedAway(entries,painted);}
   frame.refresh();
   for(const e of entries)expect(frame.state[e.row*S+88]!==0).toBe(painted.has(e));
  }
  expect(rebuilt).toBeGreaterThan(100);
 }finally{frame.free();}
});

it('holds a paint for loading quality maps exactly as the object-reading kernel',()=>{
 const scene=new rust.RustScene(390,700,390,200,false,true,0),frame=createSceneEntryFrame(rust),state={paintDeadline:0};
 try{
  const entries=Array.from({length:6},entry);let now=100,held=0;
  frame.bind(entries,false);
  for(let round=0;round<800;round++){
   now+=pick([0,1,16,60,250]);
   for(const e of entries)if(chance(.2))Object.assign(e,entry(),{row:e.row});
   if(chance(.1))for(const e of entries){e.qualityReplacement=false;e.plantQuality=null;}
   if(chance(.05))scene.setInspection(pick([1,2]),0,0,chance(.5));
   const eligible=chance(.8);
   write(frame,entries);frame.census(entries,false);
   const wait=frame.qualityHold(scene,eligible,now);
   expect(wait).toBe(rust.scene_quality_hold(entries,state,scene,eligible,now));
   if(wait>0)held++;
  }
  expect(held).toBeGreaterThan(20);
 }finally{frame.free();scene.free();}
});

it('follows a growth of the memory',()=>{
 const frame=createSceneEntryFrame(rust),other=new rust.RustSceneEntryFrame();
 try{
  const entries=[{kind:'book',row:-1,model:{id:5,visible:true,userData:{inspectionResolution:1024}}}];
  frame.bind(entries,false);write(frame,entries);
  other.memory().grow(1);
  expect(frame.census(entries,true)&1).toBe(1);
  expect(frame.resolutions).toBe('[1024]');expect(frame.counts[0]).toBe(36);expect(frame.counts[8]).toBe(1);
 }finally{frame.free();other.free();}
});
