// The scene's per-button hit stage: the former per-entry RustSceneProjectionFrame#hit (inputs
// written, one call and its 16 results copied per button) against one
// RustSceneEntryFrame.hits per frame over the retained arena. Same inputs, outputs asserted
// equal; Node/WASM, no DOM, GPU or battery measurement.
// node scripts/benchmark-scene-entry-hits.mjs [dir with inhouse_read_shelf.js + _bg.wasm]
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
import assert from 'node:assert/strict';
import * as THREE from 'three';
const dir=resolve(process.argv[2]||'src/wasm/shelf');
const rust=await import(pathToFileURL(dir+'/inhouse_read_shelf.js').href);
rust.initSync({module:readFileSync(dir+'/inhouse_read_shelf_bg.wasm')});
const {createSceneProjectionFrame,createSceneMotionFrame}=await import('../tests/unit/helpers/scene-frame-per-entry.js');
const {createSceneEntryFrame,ENTRY_INPUT,ENTRY_OUTPUT,HIT_INPUT,HIT_OUTPUT}=await import('../src/js/scene-entry-frame.js');
const median=a=>a.toSorted((x,y)=>x-y)[Math.floor(a.length/2)],results=[];
for(const count of [40,120,300])for(const mode of ['resting','moving']){
 const scene=new rust.RustScene(390,1200,390,162,false,true,0),motion=new rust.RustRoomMotion(),transition=new rust.RustRoomTransition();
 const before=createSceneProjectionFrame(rust),after=createSceneProjectionFrame(rust),motionFrame=createSceneMotionFrame(rust,()=>null),frame=createSceneEntryFrame(rust);
 const room=new THREE.Object3D();room.rotation.set(.244,-.524,0);room.scale.setScalar(.62);room.updateMatrixWorld(true);
 const entries=Array.from({length:count},(_,index)=>({index,kind:index%13===5?1:index%17===3?2:0,box:Float64Array.of(-14,-90,-7,14,110,7),
  surface:new THREE.Object3D(),bits:0,rect:{},hitRect:{},tapRect:{}}));
 const surfaceBox=Float64Array.of(-3,-80,-2,3,80,2);
 let sink=0;
 // The frame's step, shared by both sides: the projected rectangles and placed matrices.
 function begin(tick){
  scene.beginEntries(tick*16,false,1,[0,0,0,1],2,390,0,44);motionFrame.prepare(entries,[{bottom:300}],390,650);frame.prepare(count);
  before.prepare(entries);after.prepare(entries);
  const input=frame.input;
  for(let i=0;i<count;i++){const at=i*ENTRY_INPUT;input[at]=i%20*18-180;input[at+1]=-(i%3*320+120);input[at+2]=0;input[at+6]=1;input[at+7]=1;
   input[at+8]=entries[i].kind;input.set(entries[i].box,at+16);}
  frame.step(motionFrame.native,scene,motion,transition,tick*16,false,room.matrixWorld);
  for(let i=0;i<count;i++){const e=entries[i],s=e.surface,wobble=mode==='moving'?Math.sin(tick*.07+i)*.02:0;
   s.position.set(i%20*18-180,-(i%3*320+120)+wobble*30,0);s.rotation.set(0,Math.PI/2-wobble,wobble);s.updateMatrixWorld(true);
   const v=frame.output,at=i*ENTRY_OUTPUT,r=e.rect;
   r.left=v[at+58];r.right=v[at+59];r.top=v[at+60];r.bottom=v[at+61];r.width=v[at+62];r.height=v[at+63];r.closest=v[at+64];}
 }
 const matrix=new THREE.Matrix4();
 function previous(tick,out){begin(tick);const hitIo=before.hitOutput;
  for(let i=0;i<count;i++){const e=entries[i],placed=i%4===0;
   if(placed)matrix.fromArray(frame.output,i*ENTRY_OUTPUT+42);
   const dirty=before.hit(scene,i,e.kind,false,e.bits,false,e.rect,placed?e.box:surfaceBox,placed?matrix:e.surface.matrixWorld,false,false);
   const hr=e.hitRect;hr.left=hitIo[33];hr.right=hitIo[34];hr.top=hitIo[35];hr.bottom=hitIo[36];hr.width=hitIo[37];hr.height=hitIo[38];hr.closest=hitIo[39];
   const t=e.tapRect;t.left=hitIo[40];t.top=hitIo[41];t.width=hitIo[42];t.height=hitIo[43];sink+=dirty+hitIo[44]+hitIo[45]+hitIo[46]+hitIo[47]+hitIo[48];
   if(out)out.push([dirty,...hitIo.slice(33,49)]);
  }}
 function current(tick,out){begin(tick);let v=frame.hitInput;
  for(let i=0;i<count;i++){const e=entries[i],h=i*HIT_INPUT,placed=i%4===0;
   v[h]=1|(placed?32:0);v[h+1]=e.bits;v.set(placed?e.box:surfaceBox,h+2);if(!placed)v.set(e.surface.matrixWorld.elements,h+8);}
  frame.hits(after.native,scene);v=frame.hitOutput;
  for(let i=0;i<count;i++){const e=entries[i],h=i*HIT_OUTPUT;
   const hr=e.hitRect;hr.left=v[h+1];hr.right=v[h+2];hr.top=v[h+3];hr.bottom=v[h+4];hr.width=v[h+5];hr.height=v[h+6];hr.closest=v[h+7];
   const t=e.tapRect;t.left=v[h+8];t.top=v[h+9];t.width=v[h+10];t.height=v[h+11];sink+=v[h]+v[h+12]+v[h+13]+v[h+14]+v[h+15]+v[h+16];
   if(out)out.push([...v.slice(h,h+HIT_OUTPUT)]);
  }}
 try{
  for(let tick=0;tick<60;tick++){const a=[],b=[];previous(tick,a);current(tick,b);
   for(let i=0;i<count;i++)for(let k=0;k<a[i].length;k++)assert.ok(Object.is(a[i][k],b[i][k]),`entry ${i} value ${k}: ${a[i][k]} vs ${b[i][k]}`);}
  const loops=60,time=fn=>{const start=performance.now();for(let i=0;i<loops;i++)fn(i);return(performance.now()-start)/loops;};
  // The shared step and surface updates are timed alone and subtracted: only the hit stage differs.
  const base=[],old=[],batched=[];
  for(let round=0;round<31;round++){base.push(time(begin));if(round%2){batched.push(time(current));old.push(time(previous));}else{old.push(time(previous));batched.push(time(current));}}
  const stage=list=>Math.max(0,median(list)-median(base));
  results.push({count,mode,sharedMs:+median(base).toFixed(4),perEntryHitsMs:+stage(old).toFixed(4),oneCallHitsMs:+stage(batched).toFixed(4),
   speedup:+(stage(old)/stage(batched)).toFixed(2),sink:Number.isFinite(sink)});
 }finally{before.free();after.free();motionFrame.free();frame.free();scene.free();motion.free();transition.free();}
}
console.log(JSON.stringify({date:new Date().toISOString(),scope:'scene hit stage per frame, Node/WASM, shared host',results},null,1));
