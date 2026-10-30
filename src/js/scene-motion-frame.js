// The host retains Three objects and independent outgoing snapshots. Rust owns
// coordinate conversion and combines remote preview/checkpoint sampling.
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
  // `native` is the arena the whole-scene entry frame samples from (scene-entry-frame.js).
  return {output,native,prepare,sample,key:index=>keys[index],invalidate(){entries=null;},free(){
    if(disposed)return;native.free();disposed=true;entries=null;keys=[];input=rows=nativeOutput=buffer=null;
  }};
}
