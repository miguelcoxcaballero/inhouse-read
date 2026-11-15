// @vitest-environment node
import {afterAll,beforeAll,expect,it,vi} from 'vitest';
import {rustShelf as rust,shelfWasm} from './helpers/rust-shelf-ready.js';
import {createSceneEntryFrame,ENTRY_STATE,ENTRY_OUTPUT} from '../../src/js/scene-entry-frame.js';
import {createSceneMotionFrame} from './helpers/scene-motion-frame.js';
import {referenceBind,referenceReorderStep,referenceReorderKeep,createReferenceRoomEpoch,referenceStamped} from './helpers/reference-scene-rows.js';

// The arena's rows across layouts, a reorder's offsets and the room's epoch moved from the host
// into Rust (rust-ui/src/scene_rows.rs). The frozen host code (helpers/reference-scene-rows.js)
// must give the same bits.
// The solver's first step settles against an 80 ms wall clock (book_gravity.rs): on a busy machine the
// two solvers compared below would stop at different steps. A still clock lets both finish.
let wallClock;
beforeAll(()=>{wallClock=vi.spyOn(Date,'now').mockReturnValue(1.7e12);});
afterAll(()=>wallClock.mockRestore());
const S=ENTRY_STATE;
const bytes=values=>Buffer.from(values.buffer,values.byteOffset,values.byteLength).toString('hex');
function random(seed){let s=seed>>>0;return()=>{s=s+0x6d2b79f5|0;let t=Math.imul(s^s>>>15,1|s);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
const odd=[0,-0,NaN,Infinity,-Infinity,1e-310,5e-324,-1.5,2**53];

it('binds layouts and eases reorders as the host did, bit for bit',()=>{
 for(let session=0;session<40;session++){
  const next=random(session*7919+1),frame=createSceneEntryFrame(rust),scene=new rust.RustScene(600,900,600,250,false,false,0);
  const motionFrame=createSceneMotionFrame(rust,()=>null),roomMotion=new rust.RustRoomMotion(),roomTransition=new rust.RustRoomTransition();
  const room={elements:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]};
  const number=()=>next()<.08?odd[Math.floor(next()*odd.length)]:(next()-.5)*2000;
  try{
   let entries=[],mirror=null,items=[],now=0,reorders=0,steps=0,dropped=0,ended=0,idle=0;
   const layout=reset=>{
    // Some entries leave, the rest are shuffled, new ones arrive.
    const kept=entries.filter(()=>next()>.2);
    for(let index=kept.length-1;index>0;index--){const other=Math.floor(next()*(index+1));[kept[index],kept[other]]=[kept[other],kept[index]];}
    const arriving=Math.floor(next()*5);
    for(let index=0;index<arriving;index++)kept.splice(Math.floor(next()*(kept.length+1)),0,{row:-1,shelf:0});
    const before=items.length;
    items=referenceReorderKeep(items,kept,scene.reordering);dropped+=before-items.length;
    const twins=kept.map(entry=>({row:entry.row}));
    mirror=referenceBind(mirror,twins,reset,S);
    // The other arenas keep their numbers where they were.
    const output=entries.length?(frame.refresh(),frame.output.slice()):new Float64Array(0);
    frame.bind(kept,reset);entries=kept;
    expect(entries.map(entry=>entry.row)).toEqual(twins.map(twin=>twin.row));
    const shared=Math.min(output.length,frame.output.length);
    expect(bytes(frame.output.subarray(0,shared))).toBe(bytes(output.subarray(0,shared)));
    expect(frame.output).toHaveLength(entries.length*ENTRY_OUTPUT);
    expect(bytes(frame.state),`session ${session} layout`).toBe(bytes(mirror));
   };
   layout(true);
   for(let step=0;step<160;step++){
    const dice=next();now+=next()*140;
    if(dice<.18)layout(next()<.7);
    else if(dice<.3&&entries.length){
     // The host's state between frames (any column: a layout only moves it) and the frame's results.
     frame.refresh();
     for(let write=0;write<entries.length*20;write++){const at=Math.floor(next()*mirror.length),value=number();mirror[at]=value;frame.state[at]=value;}
     for(let write=0;write<entries.length*10;write++)frame.output[Math.floor(next()*frame.output.length)]=number();
     expect(bytes(frame.state)).toBe(bytes(mirror));
     // A layout follows at once: the pose call below is never handed these numbers.
     layout(next()<.7);
     frame.refresh();frame.state.fill(0);mirror.fill(0);
    }else if(dice<.45){
     // Offsets are differences of rectangles: finite, either sign, sometimes a signed zero.
     const offset=()=>next()<.1?next()<.5?0:-0:(next()-.5)*900;
     const flat=[];items=[];
     for(const entry of entries)if(next()<.5){const x=offset(),y=offset();items.push({entry,x,y});flat.push(entry.row,x,y);}
     frame.lamp.reorder(flat);scene.beginReorder(now);reorders++;
    }else{
     // A frame: its first step, then the pose call, which writes what the reorder leaves of each offset.
     if(next()<.1)shelfWasm.memory.grow(1);
     const begun=scene.beginFrame(now);
     if(begun&2){items=referenceReorderStep(mirror,items,scene.reorderLeft,Boolean(begun&4),S);steps++;if(begun&4)ended++;}else idle++;
     scene.beginEntries(now,false,1,new Float64Array([0,0,0,1]),1,600,0,18);
     motionFrame.prepare(entries,[],600,1000);
     frame.poses(motionFrame.native,scene,roomMotion,roomTransition,now,false,room);
     // The step itself reads the offsets and leaves them as they are.
     for(let at=0;at<mirror.length;at+=S)expect(bytes(frame.state.subarray(at+21,at+23)),`session ${session} step ${step} row ${at/S}`).toBe(bytes(mirror.subarray(at+21,at+23)));
     mirror.set(frame.state);
    }
   }
   expect(reorders).toBeGreaterThan(5);expect(steps).toBeGreaterThan(10);expect(idle).toBeGreaterThan(3);
   if(session===0){expect(dropped).toBeGreaterThan(0);expect(ended).toBeGreaterThan(0);}
  }finally{frame.free();scene.free();motionFrame.free();roomMotion.free();roomTransition.free();}
 }
});

it('advances the room\'s epoch in the pose call exactly when the host\'s bit comparison did',()=>{
 const next=random(4242),frame=createSceneEntryFrame(rust),scene=new rust.RustScene(600,900,600,250,false,false,0);
 const motionFrame=createSceneMotionFrame(rust,()=>null),roomMotion=new rust.RustRoomMotion(),roomTransition=new rust.RustRoomTransition();
 const epochOf=createReferenceRoomEpoch();
 try{
  frame.bind([],true);motionFrame.prepare([],[],600,1000);
  const room={elements:Array.from({length:16},()=>next()*10)};
  let moved=0,stood=0;
  for(let step=0;step<6000;step++){
   const dice=next(),at=Math.floor(next()*16);
   if(dice<.25)room.elements[at]=next()<.3?odd[Math.floor(next()*odd.length)]:next()*10;
   // A zero that changes its sign is a change; NaN stays NaN.
   else if(dice<.35)room.elements[at]=Object.is(room.elements[at],0)?-0:0;
   else if(dice<.37)shelfWasm.memory.grow(1);
   const expected=epochOf(room.elements);
   const call=step%3;
   if(call===0)frame.poses(motionFrame.native,scene,roomMotion,roomTransition,step,false,room);
   else frame.place(call===1,motionFrame.native,scene,roomMotion,roomTransition,step,false,room);
   frame.refresh();
   expect([frame.walk[0],frame.walk[1]===1],`step ${step}`).toEqual(expected);
   if(expected[1])moved++;else stood++;
  }
  expect(moved).toBeGreaterThan(1000);expect(stood).toBeGreaterThan(1000);
 }finally{frame.free();scene.free();motionFrame.free();roomMotion.free();roomTransition.free();}
});

// The host no longer compares a stamp of each standing decoration in every frame: it describes the
// solid again whenever the entry's size or the room's scale may have changed, and the solver keeps
// a solid whose description is the same.
it('describes a decoration\'s solid whenever the former stamp did',()=>{
 const next=random(7);
 for(let session=0;session<200;session++){
  const entries=Array.from({length:6},(_,index)=>({height:80+index,width:40,catalogId:'a',variant:0,potId:'p',lampId:'l',stale:true,solid:false,collisionStamp:null}));
  let pixelsPerMetre=1000,staticStale=true,described=0,extra=0;
  for(let frame=0;frame<120;frame++){
   const dice=next();
   if(dice<.1){
    // A layout: every retained entry takes its data again (placeBoxes marks it stale) and the scale may change.
    for(const entry of entries){if(next()<.3)entry[['height','width','variant','catalogId','potId','lampId'][Math.floor(next()*6)]]=Math.floor(next()*4);entry.stale=true;}
    if(next()<.3)pixelsPerMetre=900+Math.floor(next()*3)*100;
    staticStale=true;
   }else if(dice<.14)for(const entry of entries){entry.collisionStamp=null;entry.solid=false;}
   const usePhysics=next()<.8;
   for(const entry of entries){
    const stale=staticStale||entry.stale;
    if(stale)entry.solid=false;
    let now=false;
    if(usePhysics){
     const formerly=referenceStamped(entry,pixelsPerMetre);
     if(!entry.solid){entry.solid=true;now=true;}
     // Never fewer descriptions than before; an added one repeats what the solver already holds.
     if(formerly){expect(now,`session ${session} frame ${frame}`).toBe(true);described++;}else if(now)extra++;
    }
    entry.stale=false;
   }
   staticStale=false;
  }
  expect(described).toBeGreaterThan(6);expect(extra).toBeGreaterThan(0);
 }
});

it('keeps the rigid bodies bit for bit when a decoration is described again with the same solid',()=>{
 const rows=[{id:'a',x:80},{id:'pot',x:200,kind:1,width:60,height:100},{id:'b',x:300},{id:'lamp',x:430,kind:2,width:120,height:260},{id:'c',x:520}];
 const describe=solver=>{solver.decoration('pot',1,'muskot','muskot',Float64Array.of(.03,.07,.16,0));solver.decoration('lamp',2,'','',Float64Array.of(0,0,0,.001));};
 const sides=[0,1].map(()=>({solver:new rust.RustBookGravity(),scene:new rust.RustScene(600,1200,600,250,false,false,0),clock:0,flags:0,drag:0}));
 const step=side=>{
  side.scene.beginEntries(side.clock,false,1,new Float64Array([0,0,0,1]),1,600,0,18);
  const states=new Float64Array(rows.length*37),geometry=new Float64Array(rows.length*9);
  rows.forEach((b,i)=>{
   const height=b.height??200,y=300-height/2;
   states.set([b.kind??0,0,i===0?side.flags:0,i===0?side.drag:0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,b.x,y,150,height,150,0],i*37);
   geometry.set([b.width??20,b.kind??0,0,1000,0,600,300,10,0],i*9);
  });
  const output=new Float64Array(rows.length*4);
  side.solver.step(rows.map(b=>b.id),states,geometry,side.scene,side.clock,false,output);side.clock+=1000/60;
  return bytes(output);
 };
 try{
  for(const side of sides)describe(side.solver);
  for(let frame=0;frame<700;frame++){
   // A book is dragged into the pot, then let go.
   for(const side of sides){side.flags=frame>200&&frame<420?2:0;side.drag=frame>200&&frame<420?(frame-200)*.6:0;}
   // The second host describes both solids again before every frame, as a layout now does.
   describe(sides[1].solver);
   expect(step(sides[1]),`frame ${frame}`).toBe(step(sides[0]));
  }
  expect(sides[1].solver.snapshot()).toBe(sides[0].solver.snapshot());
 }finally{for(const side of sides){side.solver.free();side.scene.free();}}
});
