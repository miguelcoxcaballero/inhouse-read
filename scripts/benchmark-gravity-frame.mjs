// CPU-only frame bridge benchmark; includes host packing, physics and result reads.
// It measures no renderer, mobile device, battery drain or whole-app frame rate.
import { readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import assert from 'node:assert/strict';
import * as rust from '../src/wasm/shelf/inhouse_read_shelf.js';
import { createGravityFrame } from '../src/js/gravity-frame.js';
rust.initSync({module:readFileSync(new URL('../src/wasm/shelf/inhouse_read_shelf_bg.wasm',import.meta.url))});
const rotation=new Float64Array([0,0,0,1]),median=a=>a.toSorted((a,b)=>a-b)[Math.floor(a.length/2)];
const results=[];
for(const count of [24,96,240]){
 const entries=Array.from({length:count},(_,i)=>({key:`book:drive:1U8C8T7KM6Cylibrary-record-${i}`,x:60+i*32,y:200,width:150,height:200,depth:150,depthInset:0,thickness:20,shelf:0,
  bits:2,dragNumberX:0,dragNumberY:0,gripHeight:0,lift:{value:0,from:0,target:0,started:0},landing:null,
  preview:{x:0,y:0,fromX:0,fromY:0,targetX:0,targetY:0,started:0,active:false},offset:{x:0,y:0}}));
 const width=120+count*32,bay={left:0,right:width,bottom:300,ceiling:10};
 const scene=new rust.RustScene(width,1200,width,250,false,false,0),oldSolver=new rust.RustBookGravity(),newSolver=new rust.RustBookGravity(),frame=createGravityFrame(rust);
 const states=new Float64Array(count*37),geometry=new Float64Array(count*9),output=new Float64Array(count*4),step=new Float64Array(37),presented=new Float64Array(40);
 let now=0,checksum=0;
 function legacy(){
  const keys=entries.map((e,i)=>{
   const l=e.lift,p=e.preview,a=e.landing;
   step[0]=0;step[1]=0;step[2]=e.bits;step[3]=e.dragNumberX;step[4]=e.dragNumberY;
   step[5]=l.value;step[6]=l.from;step[7]=l.target;step[8]=l.started;step[9]=a?1:0;
   if(a){step[10]=a.from;step[11]=a.started;step[12]=a.duration;}
   step[13]=p.x;step[14]=p.y;step[15]=p.fromX;step[16]=p.fromY;step[17]=p.targetX;step[18]=p.targetY;step[19]=p.started;step[20]=p.active?1:0;
   step[21]=e.offset.x;step[22]=e.offset.y;step[23]=e.x;step[24]=e.y;step[25]=e.width;step[26]=e.height;step[27]=e.depth;step[28]=e.depthInset;
   states.set(step,i*37);geometry.set([e.thickness,0,e.shelf||0,1000,bay.left||0,bay.right??width,bay.bottom??e.y+e.height/2,bay.ceiling??bay.top??0,e.gripHeight||0],i*9);
   return e.key;
  });
  oldSolver.step(keys,states,geometry,scene,now,false,output);
  for(let i=0;i<count;i++){
   step.set(states.subarray(i*37,(i+1)*37));
   const x=entries[i].x-width/2+output[i*4+1],y=-entries[i].y+output[i*4+2],z=step[34]+output[i*4];
   const order=output[i*4]===0?0:1,active=output[i*4+3]!==0?1:0;
   const flags=entries[i].bits|(output[i*4+3]?16:0)|(Math.abs(output[i*4])>.001?32:0);
   checksum+=x+y+z+step[31]+step[32]+step[33]+step[35]+order+active+flags;
  }
 }
 function retained(){
  frame.prepare(entries);for(let i=0;i<count;i++)frame.write(i,entries[i],0,false,bay,1000,width);
  frame.advance(newSolver,scene,now,false);
  for(let i=0;i<count;i++){frame.copyState(i,presented);checksum+=presented[29]+presented[30]+presented[34]+presented[31]+presented[32]+presented[33]+presented[35]+presented[37]+presented[38]+presented[39];}
 }
 try{
  for(let i=0;i<90;i++){now+=1000/60;scene.beginEntries(now,false,1,rotation,1,width,0,18);legacy();retained();}
  assert.deepEqual(frame.output,output);
  for(let i=0;i<count;i++){
   frame.copyState(i,presented);
   assert.equal(presented[29],entries[i].x-width/2+output[i*4+1]);
   assert.equal(presented[30],-entries[i].y+output[i*4+2]);
   assert.equal(presented[34],states[i*37+34]+output[i*4]);
   assert.equal(presented[37],output[i*4]===0?0:1);
   assert.equal(presented[38],output[i*4+3]!==0?1:0);
   assert.equal(presented[39],entries[i].bits|(output[i*4+3]?16:0)|(Math.abs(output[i*4])>.001?32:0));
  }
  const samples={legacy:[],retained:[]};
  for(let round=0;round<31;round++){
   for(const kind of round%2?['retained','legacy']:['legacy','retained']){
    const start=performance.now();for(let i=0;i<20;i++)(kind==='retained'?retained:legacy)();samples[kind].push((performance.now()-start)/20);
   }
  }
  assert.deepEqual(frame.output,output);
  for(let i=0;i<count;i++){
   frame.copyState(i,presented);
   assert.equal(presented[29],entries[i].x-width/2+output[i*4+1]);
   assert.equal(presented[30],-entries[i].y+output[i*4+2]);
   assert.equal(presented[34],states[i*37+34]+output[i*4]);
   assert.equal(presented[37],output[i*4]===0?0:1);
   assert.equal(presented[38],output[i*4+3]!==0?1:0);
   assert.equal(presented[39],entries[i].bits|(output[i*4+3]?16:0)|(Math.abs(output[i*4])>.001?32:0));
  }
  const oldMs=median(samples.legacy),newMs=median(samples.retained);
  results.push({objects:count,legacyMs:oldMs,retainedMs:newMs,speedup:oldMs/newMs,exactOutput:true,exactPose:true});
 }finally{frame.free();oldSolver.free();newSolver.free();scene.free();}
}
const report={node:process.version,scope:'Synthetic settled physics scenes, host field packing, complete solver call, physical pose composition and per-entry result reads. No rendering or whole-app speed.',warmups:90,rounds:31,iterations:20,results};
if(process.argv[2])writeFileSync(process.argv[2],JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
