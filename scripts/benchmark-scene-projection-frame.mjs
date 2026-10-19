// Full numeric projection + semantic-style bridge. No DOM layout or GPU timing.
import {readFileSync,writeFileSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import * as rust from '../src/wasm/shelf/inhouse_read_shelf.js';
import {createSceneProjectionFrame} from '../src/js/scene-projection-frame.js';
rust.initSync({module:readFileSync(new URL('../src/wasm/shelf/inhouse_read_shelf_bg.wasm',import.meta.url))});
const median=a=>a.toSorted((a,b)=>a-b)[Math.floor(a.length/2)],results=[];
const state=()=>({left:NaN,top:NaN,width:NaN,height:NaN,z:NaN,fixed:false,coverLeft:NaN,coverTop:NaN,coverWidth:NaN,coverHeight:NaN,display:'',events:'',coverFixed:false});
for(const count of [24,96,240])for(const mode of ['stationary','moving']){
 const scene=new rust.RustScene(640,1200,640,200,false,true,0),frame=createSceneProjectionFrame(rust);
 const entries=Array.from({length:count},(_,i)=>({kind:i%7===0?1:i%11===0?2:0,model:{},overview:false,box:Float64Array.of(-15,-100,-7,15,100,7),matrix:new THREE.Matrix4().makeTranslation(i%20*30,-Math.floor(i/20)*250,-20)}));
 const caches=entries.map(state),project=new Float64Array(44),hit=new Float64Array(49),rect={};
 let checksum=0;
 function begin(tick){scene.beginEntries(tick*16,false,1,[0,0,0,1],2,640,0,44);if(mode==='moving')for(const [i,e]of entries.entries())e.matrix.elements[12]=i%20*30+tick%15*.3;}
 function consume(value){checksum+=String(value).length;}
 function oldStyle(c,v,r,kind){
  if(!c.fixed)consume('absolute');
  if(v[40]!==c.left)consume(`${c.left=v[40]}px`);if(v[41]!==c.top)consume(`${c.top=v[41]}px`);if(v[42]!==c.width)consume(`${c.width=v[42]}px`);if(v[43]!==c.height)consume(`${c.height=v[43]}px`);
  if(!c.fixed)consume('0');if(v[44]!==c.z)consume(String(c.z=v[44]));if(!c.fixed){consume('true');c.fixed=true;}
  if(kind!==1){
   if(!c.coverFixed)consume('absolute');
   if(v[45]!==c.coverLeft)consume(`${c.coverLeft=v[45]}px`);if(v[46]!==c.coverTop)consume(`${c.coverTop=v[46]}px`);if(r.width!==c.coverWidth)consume(`${c.coverWidth=r.width}px`);if(r.height!==c.coverHeight)consume(`${c.coverHeight=r.height}px`);
   const display=v[47]?'block':'none';if(display!==c.display)consume(c.display=display);if(!c.coverFixed){consume('transparent');c.coverFixed=true;}const events=v[48]?'inherit':'none';if(events!==c.events)consume(c.events=events);
  }
 }
 function newStyle(bits,v,r){
  if(bits&1)consume('absolute');if(bits&2)consume(`${v[40]}px`);if(bits&4)consume(`${v[41]}px`);if(bits&8)consume(`${v[42]}px`);if(bits&16)consume(`${v[43]}px`);
  if(bits&1)consume('0');if(bits&32)consume(String(v[44]));if(bits&1)consume('true');
  if(bits&64)consume('absolute');if(bits&128)consume(`${v[45]}px`);if(bits&256)consume(`${v[46]}px`);if(bits&512)consume(`${r.width}px`);if(bits&1024)consume(`${r.height}px`);
  if(bits&2048)consume(v[47]?'block':'none');if(bits&64)consume('transparent');if(bits&4096)consume(v[48]?'inherit':'none');
 }
 function setRect(v){rect.left=v[30];rect.right=v[31];rect.top=v[32];rect.bottom=v[33];rect.width=v[34];rect.height=v[35];rect.closest=v[36];}
 function previous(tick){begin(tick);for(let i=0;i<count;i++){
  const e=entries[i],kind=e.kind;project[0]=kind;project[1]=0;project[2]=0;project[3]=0;project[4]=1;project[5]=0;project[6]=0;project[7]=0;project.set(e.box,8);project.set(e.matrix.elements,14);scene.projectEntry(project);setRect(project);
  hit[0]=kind;hit[1]=0;hit[2]=0;hit[3]=0;hit[4]=rect.left;hit[5]=rect.right;hit[6]=rect.top;hit[7]=rect.bottom;hit[8]=rect.width;hit[9]=rect.height;hit[10]=rect.closest;hit.set(e.box,11);hit.set(e.matrix.elements,17);scene.hitEntry(hit);oldStyle(caches[i],hit,rect,kind);
 }}
 function current(tick){begin(tick);frame.prepare(entries);for(let i=0;i<count;i++){
  const e=entries[i];frame.project(scene,e,e.kind,0,null,null,e.matrix);setRect(frame.projection);const dirty=frame.hit(scene,i,e.kind,false,0,false,rect,e.box,e.matrix,false,false);newStyle(dirty,frame.hitOutput,rect);
 }}
 try{
  for(let i=0;i<100;i++){const start=checksum;previous(i);const before=checksum;current(i);assert.equal(checksum-before,before-start);assert.deepEqual(frame.projection.slice(30),project.slice(30));assert.deepEqual(frame.hitOutput.slice(33),hit.slice(33));}
  const previousTimes=[],nativeTimes=[],loops=50;
  const time=fn=>{const start=performance.now();for(let i=0;i<loops;i++)fn(i);return(performance.now()-start)/loops;};
  for(let round=0;round<31;round++){if(round%2){nativeTimes.push(time(current));previousTimes.push(time(previous));}else{previousTimes.push(time(previous));nativeTimes.push(time(current));}}
  const oldMs=median(previousTimes),nativeMs=median(nativeTimes);results.push({count,mode,oldMs,nativeMs,speedup:oldMs/nativeMs,checksum});
 }finally{frame.free();scene.free();}
}
const report={date:new Date().toISOString(),scope:'synthetic numeric projection/style bridge; no DOM, GPU or battery measurement; shared host load',results};
console.log(JSON.stringify(report,null,2));if(process.argv[2])writeFileSync(process.argv[2],JSON.stringify(report,null,2)+'\n');
