// Compare the full old per-plant bridge with the retained native scene arena.
// This isolates hit-target bookkeeping, not GPU render time or whole-app FPS.
import {readFileSync,writeFileSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
import * as THREE from 'three';
import * as rust from '../src/wasm/shelf/inhouse_read_shelf.js';
import {createFoliageFrame} from '../src/js/foliage-frame.js';
rust.initSync({module:readFileSync(new URL('../src/wasm/shelf/inhouse_read_shelf_bg.wasm',import.meta.url))});
const box=(left,top,width,height)=>({left,top,width,height,right:left+width,bottom:top+height});
function legacy(){
 let model=null,pose=[],bounds,previous=new Float64Array(0);
 return {step(next,q,rect,areas){
  const elements=next.matrix.elements;
  let moved=model!==next||q.x!==pose[16]||q.y!==pose[17]||q.z!==pose[18]||q.w!==pose[19];
  for(let i=0;i<16&&!moved;i++)moved=elements[i]!==pose[i];
  if(moved){model=next;bounds={...rect};for(let i=0;i<16;i++)pose[i]=elements[i];pose[16]=q.x;pose[17]=q.y;pose[18]=q.z;pose[19]=q.w;}
  const input=new Float64Array(10+areas.length*4);
  input.set([bounds.left,bounds.right,bounds.top,bounds.bottom,bounds.width,bounds.height,rect.left,rect.top,rect.width,rect.height]);
  let at=10;for(const area of areas){input[at++]=area.left;input[at++]=area.right;input[at++]=area.top;input[at++]=area.bottom;}
  const path=rust.scene_foliage_clip(previous,input);if(path)previous=input;
  return path;
 }};
}
const median=values=>values.toSorted((a,b)=>a-b)[Math.floor(values.length/2)];
const results=[];
for(const [objects,plants] of [[24,4],[96,8],[240,12]])for(const mode of ['stationary','scroll']){
 const frame=createFoliageFrame(rust),states=Array.from({length:plants},()=>frame.createState());
 const previous=Array.from({length:plants},legacy),models=Array.from({length:plants},()=>new THREE.Object3D()),q=new THREE.Quaternion();
 const areas=Array.from({length:objects},(_,i)=>box(i*13,20+(i%3)*30,8,100));
 const rects=Array.from({length:plants},(_,i)=>box(i*23,0,150,220));
 let tick=0,checksum=0;
 function shift(){if(mode==='stationary')return;const x=(tick++%25)*.07;for(let i=0;i<areas.length;i++){areas[i].left=i*13+x;areas[i].right=areas[i].left+8;}for(let i=0;i<rects.length;i++){rects[i].left=i*23+x;rects[i].right=rects[i].left+150;}}
 function old(){for(let i=0;i<plants;i++)checksum+=previous[i].step(models[i],q,rects[i],areas).length;}
 function current(){frame.prepare(areas);for(let i=0;i<plants;i++){states[i].pose(models[i],q,rects[i]);checksum+=states[i].clip().length;}}
 try{
  for(let i=0;i<120;i++){
   shift();frame.prepare(areas);
   for(let p=0;p<plants;p++){
    states[p].pose(models[p],q,rects[p]);const actual=states[p].clip(),expected=previous[p].step(models[p],q,rects[p],areas);
    if(actual!==expected)throw Error(`clip mismatch ${objects}/${plants}/${mode}/${i}/${p}`);
   }
  }
  const loops=mode==='stationary'?400:12,oldTimes=[],newTimes=[];
  function time(fn){const start=performance.now();for(let i=0;i<loops;i++){shift();fn();}return(performance.now()-start)/loops;}
  for(let round=0;round<25;round++){
   if(round%2){newTimes.push(time(current));oldTimes.push(time(old));}
   else{oldTimes.push(time(old));newTimes.push(time(current));}
  }
  const oldMs=median(oldTimes),nativeMs=median(newTimes);
  results.push({objects,plants,mode,oldMs,nativeMs,speedup:oldMs/nativeMs,checksum});
 }finally{frame.free();}
}
const report={date:new Date().toISOString(),scope:'synthetic hit-target bridge, no rendering; shared host load',results};
console.log(JSON.stringify(report,null,2));if(process.argv[2])writeFileSync(process.argv[2],JSON.stringify(report,null,2)+'\n');
