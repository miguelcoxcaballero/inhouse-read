// @vitest-environment node
import {rustShelf} from './rust-shelf-ready.js'
export function fixture(rows,metal=false,animated=false){
 const solver=new rustShelf.RustBookGravity(),scene=new rustShelf.RustScene(600,1200,600,250,metal,false,0);
 let clock=0;const previous=new Map();
 return {rows,decoration:(...args)=>solver.decoration(...args),pause:()=>solver.pause(),snapshot:()=>solver.snapshot(),restore:value=>solver.restore(value),step(frames=1,reduced=false,frameMs=1000/60){let output;
  for(let frame=0;frame<frames;frame++){
   scene.beginEntries(clock,reduced,1,new Float64Array([0,0,0,1]),1,600,0,18);
   const states=new Float64Array(rows.length*37),geometry=new Float64Array(rows.length*9);
   rows.forEach((b,i)=>{
    const height=b.height??200,y=(b.floor??300)-height/2;
    states.set([b.kind===3?2:b.kind??0,b.kind===3?1:0,b.flags??0,b.drag??0,b.dragY??0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,b.x,y,150,height,150,0],i*37);
    states[i*37+13]=b.previewX??0;states[i*37+14]=b.previewY??0;states[i*37+21]=b.offsetX??0;states[i*37+22]=b.offsetY??0;
    if(animated&&previous.has(b.id))states.set(previous.get(b.id).subarray(5,23),i*37+5);
    geometry.set([b.width??20,b.kind??0,b.shelf??0,1000,0,600,b.floor??300,b.ceiling??((b.floor??300)-290+((b.shelf??0)>0?15/.65-10:0)),b.grip??0],i*9);
   });
   output=new Float64Array(rows.length*4);solver.step(rows.map(b=>b.id),states,geometry,scene,clock,reduced,output);clock+=frameMs;
   if(animated)rows.forEach((b,i)=>previous.set(b.id,states.slice(i*37,i*37+37)));
  }
  return rows.map((b,i)=>({angle:output[i*4],x:b.x+output[i*4+1],y:(b.floor??300)-(b.height??200)/2-output[i*4+2],active:output[i*4+3]}));
 },free(){solver.free();scene.free()}};
}
export const book=(id,x,extra={})=>({id,x,...extra});
