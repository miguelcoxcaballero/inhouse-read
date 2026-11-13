// The host retains Three objects and independent outgoing snapshots. Rust owns
// coordinate conversion and combines remote preview/checkpoint sampling; the
// whole-scene entry frame (scene-entry-frame.js) samples every entry from `native`.
export function createSceneMotionFrame(rust, motionKey) {
  const native=new rust.RustSceneMotionFrame(),memory=native.memory(),inputAt=native.input_ptr();
  let entries=null,keys=[],count=-1,rowsAt=0,buffer=null,input,rows,disposed=false;
  // Each shared key has one number for the scene's whole life (0: no key), so Rust can remember poses per key.
  const names=[null],numbers=new Map();
  function prepare(next,bays,width,ppm){
    if(disposed)throw new Error('Scene motion frame has been disposed');
    if(entries!==next){
      keys=next.map(motionKey);native.register(keys,Float64Array.from(next,entry=>entry.shelf||0));
      native.identify(Uint32Array.from(keys,key=>{
        if(typeof key!=='string'||!key)return 0;
        let number=numbers.get(key);
        if(number===undefined){number=names.length;names.push(key);numbers.set(key,number);}
        return number;
      }));
      entries=next;
    }
    if(count!==bays.length){count=bays.length;native.resize_rows(count);rowsAt=native.rows_ptr();buffer=null;}
    if(buffer!==memory.buffer){buffer=memory.buffer;input=new Float64Array(buffer,inputAt,10);rows=new Float64Array(buffer,rowsAt,Math.max(0,count)*3);}
    input[8]=width;input[9]=ppm;
    for(let i=0;i<count;i++){const bay=bays[i],at=i*3;rows[at]=bay?1:0;rows[at+1]=bay?.left||0;rows[at+2]=bay?.bottom||0;}
  }
  return {native,prepare,key:index=>keys[index],name:number=>names[number],invalidate(){entries=null;},free(){
    if(disposed)return;native.free();disposed=true;entries=null;keys=[];input=rows=buffer=null;
  }};
}
