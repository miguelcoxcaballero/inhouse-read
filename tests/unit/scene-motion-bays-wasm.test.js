// @vitest-environment node
import {expect,it} from 'vitest';
import {rustShelf as rust} from './helpers/rust-shelf-ready.js';
import {createSceneMotionFrame} from './helpers/scene-motion-frame.js';

// The shared room's keys, shelves and bays reach the motion frame once per layout (bookshelf-scene.js
// `tellMotion`: register, identify and RustSceneMotionFrame#bays over the host's packed shelves),
// no longer through an adapter that compared the entries' array and wrote every bay through a view
// in every frame (tests/unit/helpers/scene-motion-frame.js, the app's adapter until 1.8.1). Both
// must leave the same bays, width, pixels per metre, and the same samples of every entry.
const bits=values=>Array.from(values,value=>Object.is(value,-0)?'-0':String(value));
function random(seed){let s=seed>>>0;return()=>{s=s+0x6d2b79f5|0;let t=Math.imul(s^s>>>15,1|s);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
// bookshelf-scene.js `packRows` and `motionKey`, as the scene has them.
function packRows(rows){
 const packed=new Float64Array(rows.length*7);
 for(let index=0;index<rows.length;index++){
  const {top,bottom,left,right,ceiling,padding}=rows[index],at=index*7;
  packed[at]=Number(top);packed[at+1]=Number(bottom);packed[at+2]=Number(left);packed[at+3]=Number(right);
  packed[at+4]=Number(ceiling??top);packed[at+5]=Number(padding);
  packed[at+6]=(left!==undefined?1:0)|(right!==undefined?2:0)|(ceiling!=null?4:0)|(padding!==undefined?8:0);
 }
 return packed;
}
const motionKey=entry=>entry.kind==='plant'||entry.kind==='lamp'?entry.key:entry.book?.driveFileId?`book:drive:${entry.book.driveFileId}`:null;

it('tells the motion frame a layout\'s keys and bays as the per-frame adapter wrote them',()=>{
 let layouts=0,frames=0,renamed=0,shared=0,odd=0;
 for(let trial=0;trial<40;trial++){
  const next=random(trial*977+13);
  const host=createSceneMotionFrame(rust,motionKey),live=new rust.RustSceneMotionFrame();
  const motions=[new rust.RustRoomMotion(),new rust.RustRoomMotion()],transitions=[new rust.RustRoomTransition(),new rust.RustRoomTransition()];
  const names=[null],numbers=new Map(),memory=live.memory();
  const view=(native,at,length)=>new Float64Array(memory.buffer,at,length);
  let entries=[],rows=[],width=600,ppm=1000,stale=true,time=1000;
  const layout=()=>{
   const count=1+Math.floor(next()*5);
   // A bay's left and bottom as a layout may give them: absent, zero, negative zero, not a number.
   const edge=()=>{const dice=next();if(dice<.12){odd++;return [undefined,0,-0,NaN][Math.floor(next()*4)];}return Math.round(next()*400)/2;};
   rows=Array.from({length:count},(_,index)=>({top:20+index*200,bottom:edge(),left:edge(),right:next()<.5?undefined:300+next()*300}));
   width=300+Math.round(next()*600);ppm=[1000,650,1083.3333333333333][Math.floor(next()*3)];
   entries=Array.from({length:Math.floor(next()*12)},(_,index)=>{
    const dice=next(),shelf=next()<.1?undefined:Math.floor(next()*(count+1));
    return dice<.2?{kind:'plant',key:`plant:${Math.floor(next()*6)}`,shelf}:dice<.3?{kind:'lamp',key:`lamp:${index}`,shelf}
     :{book:next()<.7?{driveFileId:`d${Math.floor(next()*9)}`}:next()<.5?{}:{driveFileId:''},shelf};
   });
   stale=true;layouts++;
  };
  const tell=()=>{
   stale=false;
   const keys=entries.map(motionKey);
   live.register(keys,Float64Array.from(entries,entry=>entry.shelf||0));
   live.identify(Uint32Array.from(keys,key=>{
    if(typeof key!=='string'||!key)return 0;
    let number=numbers.get(key);
    if(number===undefined){number=names.length;names.push(key);numbers.set(key,number);}
    return number;
   }));
   live.bays(packRows(rows),width,ppm);
  };
  try{
   layout();
   for(let frame=0;frame<120;frame++){
    const dice=next(),label=`trial ${trial} frame ${frame}`;
    time+=16;
    if(dice<.12)layout();
    else if(dice<.2&&entries.some(entry=>entry.book)){
     // A record's identity changes: the scene asks for the keys again (updateRecord).
     const books=entries.filter(entry=>entry.book);books[Math.floor(next()*books.length)].book={driveFileId:`d${Math.floor(next()*9)}`};
     host.invalidate();stale=true;renamed++;
    }
    host.prepare(entries,rows,width,ppm);
    if(stale)tell();
    const before=host.native;
    expect(bits(view(live,live.rows_ptr(),rows.length*3)),label).toEqual(bits(view(before,before.rows_ptr(),rows.length*3)));
    expect(bits(view(live,live.input_ptr(),10).subarray(8)),label).toEqual(bits(view(before,before.input_ptr(),10).subarray(8)));
    for(let index=0;index<entries.length;index++){
     const pose=[next()*width-width/2,-next()*900,next()*40,0,0,Math.sin(.1),Math.cos(.1),1];
     view(before,before.input_ptr(),8).set(pose);view(live,live.input_ptr(),8).set(pose);
     const arranging=next()<.2;
     const flags=[before.sample(index,motions[0],transitions[0],time,arranging),live.sample(index,motions[1],transitions[1],time,arranging)];
     expect(flags[1],label).toBe(flags[0]);
     expect(bits(view(live,live.output_ptr(),25)),label).toEqual(bits(view(before,before.output_ptr(),25)));
     if(flags[0]&1)shared++;
    }
    // Every key has the number the adapter gave it.
    for(let number=1;number<names.length;number++)expect(host.name(number),label).toBe(names[number]);
    expect(host.name(names.length),label).toBe(undefined);
    frames++;
   }
  }finally{host.free();live.free();for(const each of [...motions,...transitions])each.free();}
 }
 expect(layouts).toBeGreaterThan(400);expect(frames).toBe(4800);expect(renamed).toBeGreaterThan(200);expect(shared).toBeGreaterThan(5000);expect(odd).toBeGreaterThan(200);
});
