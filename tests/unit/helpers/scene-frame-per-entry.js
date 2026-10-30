// The scene's former per-entry host APIs, frozen from src/js/scene-motion-frame.js and
// src/js/scene-projection-frame.js (1.7.325) when the shelf loop moved to one native call per
// frame (src/js/scene-entry-frame.js). They still drive the same native per-entry methods
// (RustSceneMotionFrame#sample, RustSceneProjectionFrame#project and #hit), so the tests and
// benchmarks compare the whole-frame arena against exactly what the loop used to call.
export function createSceneMotionFrame(rust, motionKey) {
  const native=new rust.RustSceneMotionFrame(),memory=native.memory();
  const inputAt=native.input_ptr(),outputAt=native.output_ptr(),output=new Float64Array(25);
  let entries=null,keys=[],count=-1,rowsAt=0,buffer=null,input,rows,nativeOutput,disposed=false;
  function refresh(){
    if(disposed)throw new Error('Scene motion frame has been disposed');
    if(buffer===memory.buffer)return;
    buffer=memory.buffer;input=new Float64Array(buffer,inputAt,10);
    nativeOutput=new Float64Array(buffer,outputAt,25);rows=new Float64Array(buffer,rowsAt,Math.max(0,count)*3);
  }
  function prepare(next,bays,width,ppm){
    if(disposed)throw new Error('Scene motion frame has been disposed');
    if(entries!==next){keys=next.map(motionKey);native.register(keys,Float64Array.from(next,entry=>entry.shelf||0));entries=next;}
    if(count!==bays.length){count=bays.length;native.resize_rows(count);rowsAt=native.rows_ptr();buffer=null;}
    refresh();input[8]=width;input[9]=ppm;
    for(let i=0;i<count;i++){const bay=bays[i],at=i*3;rows[at]=bay?1:0;rows[at+1]=bay?.left||0;rows[at+2]=bay?.bottom||0;}
  }
  function sample(index,pose,motion,transition,now,arranging){
    refresh();if(!keys[index])return 0;
    const p=pose.position,q=pose.quaternion;
    input[0]=p.x;input[1]=p.y;input[2]=p.z;input[3]=q.x;input[4]=q.y;input[5]=q.z;input[6]=q.w;input[7]=pose.scale.x;
    const flags=native.sample(index,motion,transition,now,arranging);refresh();output.set(nativeOutput);return flags;
  }
  return {output,native,prepare,sample,key:index=>keys[index],invalidate(){entries=null;},free(){
    if(disposed)return;native.free();disposed=true;entries=null;keys=[];input=rows=nativeOutput=buffer=null;
  }};
}

export function createSceneProjectionFrame(rust) {
 const native=new rust.RustSceneProjectionFrame(),memory=native.memory();
 const projectAt=native.projection_ptr(),hitAt=native.hit_ptr();
 const projection=new Float64Array(44),hitOutput=new Float64Array(49);
 let entries=null,buffer=null,projectInput,hitInput,projectResult,hitResult,disposed=false;
 function refresh(){
  if(disposed)throw new Error('Scene projection frame has been disposed');
  if(buffer===memory.buffer)return;
  buffer=memory.buffer;projectInput=new Float64Array(buffer,projectAt,44);hitInput=new Float64Array(buffer,hitAt,49);
  projectResult=new Float64Array(buffer,projectAt+30*8,14);hitResult=new Float64Array(buffer,hitAt+33*8,16);
 }
 function prepare(next){
  if(disposed)throw new Error('Scene projection frame has been disposed');
  if(entries!==next){native.reset_entries(next.length);entries=next;}refresh();
 }
 function project(scene,entry,kind,flags,drop,insertion,matrix){
  refresh();const v=projectInput;
  v[0]=kind;v[1]=flags;v[2]=drop?1:0;v[3]=insertion?1:0;v[4]=entry.model?1:0;v[5]=entry.overview?1:0;
  v[6]=drop?.complete?1:0;v[7]=insertion?.overlayCanvas?1:0;v.set(entry.box,8);v.set(matrix.elements,14);
  native.project(scene);refresh();projection.set(projectResult,30);
 }
 function hit(scene,index,kind,undershelf,bits,disabled,rect,box,matrix,reset,freshCover){
  refresh();const v=hitInput;
  v[0]=kind;v[1]=undershelf?1:0;v[2]=bits;v[3]=disabled?1:0;
  v[4]=rect.left;v[5]=rect.right;v[6]=rect.top;v[7]=rect.bottom;v[8]=rect.width;v[9]=rect.height;v[10]=rect.closest;
  v.set(box,11);v.set(matrix.elements,17);
  const dirty=native.hit(scene,index,reset,freshCover);refresh();hitOutput.set(hitResult,33);return dirty;
 }
 return {native,prepare,project,hit,projection,hitOutput,free(){
  if(disposed)return;native.free();disposed=true;entries=buffer=projectInput=hitInput=projectResult=hitResult=null;
 }};
}
