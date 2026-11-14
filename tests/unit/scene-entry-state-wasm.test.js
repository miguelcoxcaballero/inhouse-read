// @vitest-environment node
import {afterAll,beforeAll,expect,it,vi} from 'vitest';
import * as THREE from 'three';
import {rustShelf as rust,shelfWasm} from './helpers/rust-shelf-ready.js';
import {createSceneMotionFrame} from '../../src/js/scene-motion-frame.js';
import {createSceneEntryFrame,ENTRY_STATE,ENTRY_OUTPUT} from '../../src/js/scene-entry-frame.js';
import {createGravityFrame} from '../../src/js/gravity-frame.js';
import {createGravityFrame as referenceGravityFrame} from './helpers/reference-gravity-frame.js';
import {createMarshalFrame} from './helpers/reference-scene-entry-marshal.js';

// The entries' state lives in the entry arena and a frame is one native call. The frozen host
// path (helpers/reference-scene-entry-marshal.js: entry objects marshalled into the solver or a
// step packet, read back, composed by three, written into `step`) must give the same bits: the
// whole output arena, each pose as its three object holds it, the lift, the landing, the
// preview, the lean and the frame's summary, with and without rigid bodies.
// The solver's first step settles against an 80 ms wall clock (book_gravity.rs): on a busy machine
// the two solvers compared here would stop at different steps. A still clock lets both finish.
let wallClock;
beforeAll(()=>{wallClock=vi.spyOn(Date,'now').mockReturnValue(1.7e12);});
afterAll(()=>wallClock.mockRestore());
const key=e=>e.kind==='plant'||e.kind==='lamp'?e.key:e.book?.driveFileId?`book:drive:${e.book.driveFileId}`:null;
const S=ENTRY_STATE;
const bytes=values=>Buffer.from(values.buffer,values.byteOffset,values.byteLength).toString('hex');
function data(i){
 const kind=i%7===3?'plant':i%5===2?'lamp':undefined,mount=kind==='lamp'&&i%2?'undershelf':undefined;
 return {kind,mount,key:kind?`${kind}:${i}${i%4?'':'🌿'}`:`book:${i}`,book:kind?undefined:i%3?{driveFileId:`f${i}`}:{},shelf:i%3,
  x:30+i*37,y:kind?255+(i%3)*300:200+(i%3)*300,width:kind?45:150,height:kind?90:200,depth:kind?i%2?undefined:60:150,depthInset:i%4?0:6,thickness:14+i%9,
  gripHeight:i%5?0:40,box:Float64Array.of(-14-i,-90,-7,14+i,110-i,7),bits:0,dragNumberX:0,dragNumberY:0,model:null,overview:false,trashDrop:null,insertion:null};
}
const freshPreview=()=>({x:0,y:0,fromX:0,fromY:0,targetX:0,targetY:0,started:0,active:false});
const oldEntry=d=>({...d,pose:new THREE.Object3D(),lift:{value:0,from:0,target:0,started:0},landing:null,offset:{x:0,y:0},preview:freshPreview(),lean:undefined});
const newEntry=d=>({...d,pose:new THREE.Object3D(),row:-1,stale:true,lean:undefined});

// The host's side of the arena frame, as bookshelf-scene.js's updateEntries does it.
function arenaFrame(frame,gravityFrame,motionFrame,entries,c){
 if(c.usePhysics)gravityFrame.prepare(entries);
 frame.refresh();
 for(let index=0;index<entries.length;index++){
  const e=entries[index],at=index*S,state=frame.state;
  const plant=e.kind==='plant',lamp=e.kind==='lamp',undershelf=lamp&&e.mount==='undershelf',kind=plant?1:lamp?2:0;
  if(e.stale){e.stale=false;state[at]=kind;state[at+1]=undershelf?1:0;
   state[at+23]=e.x;state[at+24]=e.y;state[at+25]=e.width;state[at+26]=e.height;state[at+27]=e.depth;state[at+28]=e.depthInset;state.set(e.box,at+50);}
  state[at+2]=e.bits;state[at+3]=e.dragNumberX;state[at+4]=e.dragNumberY;
  if(c.usePhysics){
   const row=c.rows[e.shelf||0]||c.rows[0]||{};
   state[at+40]=kind?e.width:e.thickness;state[at+41]=undershelf?3:kind;state[at+42]=e.shelf||0;state[at+43]=c.pixelsPerMetre;
   state[at+44]=row.left||0;state[at+45]=row.right??c.width;state[at+46]=row.bottom??e.y+e.height/2;state[at+47]=row.ceiling??row.top??0;state[at+48]=e.gripHeight||0;
  }
  state[at+85]=(e.trashDrop?e.trashDrop.complete?544:32:0)|(e.insertion?e.insertion.overlayCanvas?80:16:0)|(e.model?1:0);state[at+89]=e.overview?1:0;
 }
 let summary;
 if(!c.usePhysics)summary=frame.poses(motionFrame.native,c.sceneView,c.roomMotion,c.roomTransition,c.now,c.arranging,c.room);
 else if(c.split){frame.settle(gravityFrame.native,c.bookGravity,c.sceneView,c.now,c.reduced);
  summary=frame.place(true,motionFrame.native,c.sceneView,c.roomMotion,c.roomTransition,c.now,c.arranging,c.room);}
 else summary=frame.settled(gravityFrame.native,c.bookGravity,motionFrame.native,c.sceneView,c.roomMotion,c.roomTransition,c.now,c.reduced,c.arranging,c.room);
 let applied=0;
 for(let index=0;index<entries.length;index++){
  const e=entries[index],pose=e.pose,decorative=e.kind==='plant'||e.kind==='lamp';
  frame.refresh();
  const live=frame.output,at=index*ENTRY_OUTPUT,liveFlags=live[at],state=frame.state,row=index*S,changed=state[row+70];
  if(changed&1){applied++;pose.position.set(state[row+29],state[row+30],state[row+31]);
   pose.rotation.set(state[row+32],state[row+33],state[row+34],state[row+56]?'ZYX':'XYZ');pose.scale.setScalar(state[row+35]);}
  if(c.usePhysics&&!decorative)e.lean=state[row+69];
  if(liveFlags&2){pose.position.set(live[at+10],live[at+11],live[at+12]);pose.quaternion.set(live[at+13],live[at+14],live[at+15],live[at+16]);pose.scale.setScalar(live[at+17]);}
  if(liveFlags&4){pose.position.set(live[at+18],live[at+19],live[at+20]);pose.quaternion.set(live[at+21],live[at+22],live[at+23],live[at+24]);pose.scale.setScalar(live[at+25]);}
  if(changed&2){pose.matrix.fromArray(live,at+26);pose.matrixWorldNeedsUpdate=true;}
 }
 return {moving:Boolean(summary&1),shelfMoving:Boolean(summary&2),previewing:Boolean(summary&4),previewed:Math.floor(summary/8),applied};
}

for(const physicsFrom of [Infinity,0,90])for(const reduced of [false,true])it(`holds the frozen marshal path's bits (rigid bodies from frame ${physicsFrom}, reduced=${reduced})`,()=>{
 const sides=[0,1].map(()=>({sceneView:new rust.RustScene(600,1200,600,250,false,false,0),bookGravity:new rust.RustBookGravity(),
  roomMotion:new rust.RustRoomMotion(),roomTransition:new rust.RustRoomTransition(),motionFrame:createSceneMotionFrame(rust,key),entryFrame:createSceneEntryFrame(rust)}));
 const [o,n]=sides,oldGravity=referenceGravityFrame(rust),gravityFrame=createGravityFrame(rust);
 const marshal=createMarshalFrame({gravityFrame:oldGravity,entryFrame:o.entryFrame,motionFrame:o.motionFrame});
 const room=new THREE.Object3D(),inverse=new Float64Array([0,0,0,1]),rows=[{left:0,right:600,bottom:300,ceiling:10},{left:0,bottom:600,top:310},{left:0,right:600,bottom:900,ceiling:610}];
 const width=600,pixelsPerMetre=1000;
 let ds=Array.from({length:12},(_,i)=>data(i)),olds=ds.map(oldEntry),news=ds.map(newEntry),sequence=0,rested=0,total=0,stood=0,seen=new Set(),rects=new Map();
 n.entryFrame.bind(news,true);
 const state=()=>(n.entryFrame.refresh(),n.entryFrame.state);
 const both=(index,change)=>{change(olds[index],null);change(news[index],news[index].row*S);};
 const decorate=()=>olds.forEach((e,i)=>{
  if(!(e.kind==='plant'||e.kind==='lamp')||e.mount==='undershelf'||e.collisionStamp)return;
  e.collisionStamp=news[i].collisionStamp={};
  for(const side of sides)side.bookGravity.decoration(e.key,e.kind==='plant'?1:2,'','',e.kind==='plant'?new Float64Array([.02,.03,.09,0]):new Float64Array([0,0,0,.001]));
 });
 try{
  for(let tick=0;tick<420;tick++){
   const now=tick*1000/60,usePhysics=tick>=physicsFrom,arranging=tick%60>44,count=olds.length;
   const set=(index,fields)=>{if(index<count)both(index,e=>Object.assign(e,fields));};
   if(tick===10)set(0,{bits:8});
   if(tick===20)set(0,{bits:6});
   if(tick>20&&tick<70)set(0,{dragNumberX:(tick-20)*.65,dragNumberY:-12});
   if(tick===70){set(0,{bits:0,dragNumberX:0,dragNumberY:0});
    both(0,(e,at)=>{if(at===null)e.landing=e.lift.value>0?{from:e.lift.value,started:now,duration:180}:null;
     else{const s=state();if(s[at+5]>0){s[at+9]=1;s[at+10]=s[at+5];s[at+11]=now;s[at+12]=180;}}});}
   if(tick===30||tick===200)for(const index of [1,3,5])if(index<count)both(index,(e,at)=>{
    const p={x:tick===200?3:0,y:0,fromX:0,fromY:0,targetX:14+index,targetY:-3,started:now,active:true};
    if(at===null)e.preview=p;else state().set([p.x,p.y,p.fromX,p.fromY,p.targetX,p.targetY,p.started,1],at+13);});
   if(tick>=120&&tick<150)for(const index of [2,4])both(index,(e,at)=>{const x=(150-tick)*1.5,y=-(150-tick)*.5;
    if(at===null){e.offset.x=x;e.offset.y=y;}else{const s=state();s[at+21]=x;s[at+22]=y;}});
   if(tick===100)set(4,{bits:1});
   if(tick===140)set(4,{bits:0});
   if(tick%47===0)for(let index=0;index<count;index++)both(index,e=>{e.model=(tick+index)%3?{}:null;e.overview=tick%94===0;
    e.trashDrop=(tick+index)%5===0?{complete:tick%2===0}:null;e.insertion=(tick+index)%7===0?{overlayCanvas:tick%3?{}:null}:null;});
   if(tick===160)both(6,e=>{e.x+=11;e.stale=true;});
   // Layouts: the same length in another order, fewer, more. Each clears previews and landings.
   if(tick===180||tick===260||tick===330){
    let order=olds.map((_,index)=>index);
    if(tick===180)order=order.toReversed();
    if(tick===260)order=order.filter(index=>index%4!==1);
    const extra=tick===330?[data(40),data(41),data(43)]:[];
    olds=[...order.map(index=>olds[index]),...extra.map(oldEntry)];news=[...order.map(index=>news[index]),...extra.map(newEntry)];
    for(const e of olds){e.preview=freshPreview();e.landing=null;}
    n.entryFrame.bind(news,true);rects.clear();
   }
   if(tick%18===0){
    const poses=olds.filter(e=>key(e)).map((e,i)=>[key(e),i%3,.04+tick*.0001,-.12,.01,0,0,Math.sin(i*.03),Math.cos(i*.03),.9]);
    const value={from:'peer',gesture:'drag',sequence:++sequence,phase:'frame',shelfType:'walnut',poses};
    expect(n.roomMotion.receive(value,now)).toBe(o.roomMotion.receive(value,now));
   }
   if(tick%131===40){const poses=olds.filter(e=>key(e)).map(e=>[key(e),.1,-.2,.02,0,0,0,1,.8]);for(const side of sides)side.roomTransition.begin(poses,now);}
   if(tick===300)for(const side of sides)side.roomMotion.clear('peer');
   room.rotation.set(tick%120<60?.244:0,tick%120<60?-.524:0,0);room.scale.setScalar(tick%240<120?1:.8);room.updateMatrixWorld(true);
   if(usePhysics)decorate();
   for(const side of sides){
    side.sceneView.beginEntries(now,reduced,tick%200<100?1:1.6,inverse,2,600,0,44);
    side.motionFrame.prepare(side===o?olds:news,rows,width,pixelsPerMetre);
   }
   const context=side=>({usePhysics,bookGravity:side.bookGravity,sceneView:side.sceneView,roomMotion:side.roomMotion,roomTransition:side.roomTransition,
    now,reduced,arranging,rows,width,pixelsPerMetre,room:room.matrixWorld,split:tick%2===0,leanOf:(e,value)=>{e.lean=value;}});
   const expected=marshal(olds,context(o));
   if(tick%53===0)shelfWasm.memory.grow(1);
   const {applied,...actual}=arenaFrame(n.entryFrame,gravityFrame,n.motionFrame,news,context(n));
   if(tick%59===0)shelfWasm.memory.grow(1);
   expect(actual,`summary ${tick}`).toEqual(expected);
   o.entryFrame.refresh();n.entryFrame.refresh();
   expect(bytes(n.entryFrame.output),`output ${tick}`).toBe(bytes(o.entryFrame.output));
   const s=n.entryFrame.state;
   olds.forEach((e,i)=>{
    const a=news[i],at=i*S,label=`${tick}/${i}`;
    seen.add(n.entryFrame.output[i*ENTRY_OUTPUT]);
    expect(a.row).toBe(i);
    expect(bytes(Float64Array.of(...a.pose.position.toArray(),...a.pose.quaternion.toArray(),a.pose.rotation.x,a.pose.rotation.y,a.pose.rotation.z,a.pose.scale.x,...a.pose.matrix.elements)),`pose ${label}`)
     .toBe(bytes(Float64Array.of(...e.pose.position.toArray(),...e.pose.quaternion.toArray(),e.pose.rotation.x,e.pose.rotation.y,e.pose.rotation.z,e.pose.scale.x,...e.pose.matrix.elements)));
    expect(a.pose.rotation.order,`order ${label}`).toBe(e.pose.rotation.order);
    expect(bytes(s.subarray(at+5,at+9)),`lift ${label}`).toBe(bytes(Float64Array.of(e.lift.value,e.lift.from,e.lift.target,e.lift.started)));
    expect(s[at+9]!==0,`landing ${label}`).toBe(Boolean(e.landing));
    expect([Object.is(s[at+13],e.preview.x),Object.is(s[at+14],e.preview.y),s[at+20]!==0],`preview ${label}`).toEqual([true,true,e.preview.active]);
    expect(Object.is(a.lean,e.lean),`lean ${label}`).toBe(true);
    // 4 in column 70: the projected rectangle differs from the one this row held (a layout holds none).
    const rect=bytes(n.entryFrame.output.subarray(i*ENTRY_OUTPUT+58,i*ENTRY_OUTPUT+65)),moved=rects.get(a)!==rect;
    expect(Boolean(s[at+70]&4),`rectangle ${label}`).toBe(moved);
    rects.set(a,rect);if(!moved)stood++;
   });
   total+=olds.length;rested+=olds.length-applied;
  }
  expect(n.bookGravity.snapshot()).toBe(o.bookGravity.snapshot());
  for(const flags of [0,1,3,5])expect(seen.has(flags),`motion flags ${flags}`).toBe(true);
  // Without rigid bodies most frames move nothing: the pose then never reaches its three object.
  if(physicsFrom===Infinity)expect(rested/total).toBeGreaterThan(.2);
  expect(stood).toBeGreaterThan(100);
 }finally{
  oldGravity.free();gravityFrame.free();
  for(const side of sides){side.entryFrame.free();side.motionFrame.free();side.sceneView.free();side.bookGravity.free();side.roomMotion.free();side.roomTransition.free();}
 }
});

it('keeps each entry\'s row through a layout, clears what a committed layout clears and follows memory growth',()=>{
 const frame=createSceneEntryFrame(rust);
 try{
  const entries=[{row:-1},{row:-1},{row:-1}];
  frame.bind(entries,true);
  entries.forEach((e,i)=>{for(let column=0;column<S;column++)frame.state[i*S+column]=(i+1)*1000+column;});
  shelfWasm.memory.grow(1);
  const added={row:-1},next=[entries[2],added,entries[0]];
  frame.bind(next,true);
  expect(next.map(e=>e.row)).toEqual([0,1,2]);
  const s=frame.state;
  for(const [index,source] of [[0,3],[2,1]])for(let column=0;column<S;column++)
   expect(s[index*S+column],`${index}/${column}`).toBe(column>=9&&column<21?0:column===71||column===73?1:source*1000+column);
  expect(Array.from(s.subarray(S,2*S))).toEqual(Array.from({length:S},(_,column)=>column===71||column===73?1:0));
  frame.bind([],true);expect(frame.state).toHaveLength(0);
 }finally{frame.free();}
 expect(()=>frame.bind([],true)).toThrow('disposed');
});
