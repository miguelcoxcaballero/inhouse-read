// @vitest-environment node
import {expect,it} from 'vitest';
import * as THREE from 'three';
import {rustShelf as rust,shelfWasm} from './helpers/rust-shelf-ready.js';
import {createSceneEntryFrame,ENTRY_STATE} from '../../src/js/scene-entry-frame.js';
import {createSceneMotionFrame} from './helpers/scene-motion-frame.js';
import {createGravityFrame} from './helpers/gravity-frame.js';
import {createSceneProjectionFrame} from './helpers/scene-projection-frame.js';
import {referenceInverseTurn,referenceFrameRegistrations} from './helpers/reference-scene-bind.js';

// The room's inverse turn is kept by the view from its own fit instead of being read back from
// three and handed over in every frame, and the solver's keys and the buttons' style history are
// registered with a layout instead of being asked about in every frame. The frozen host code
// (helpers/reference-scene-bind.js) must give the same bits and the same registrations.
const S=ENTRY_STATE;
const bytes=values=>Buffer.from(values.buffer,values.byteOffset,values.byteLength).toString('hex');
function random(seed){let s=seed>>>0;return()=>{s=s+0x6d2b79f5|0;let t=Math.imul(s^s>>>15,1|s);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}

it('keeps the inverse of the room\'s turn that the host read back from three',()=>{
 const next=random(20261115),count=24,EMPTY=new Float64Array(0);
 // `host` is handed three's quaternion as before, `view` nothing, `wrong` a quaternion a hair off.
 const sides=['host','view','wrong'].map(name=>({name,scene:new rust.RustScene(600,900,600,250,false,false,0),frame:createSceneEntryFrame(rust),
  motionFrame:createSceneMotionFrame(rust,()=>null),roomMotion:new rust.RustRoomMotion(),roomTransition:new rust.RustRoomTransition(),out:new Float64Array(8)}));
 const furniture=new THREE.Group(),inverseRotation=new THREE.Quaternion(),inverseTurn=new Float64Array(4);
 const room={elements:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]};
 try{
  const entries=Array.from({length:count},()=>({row:-1,shelf:0}));
  for(const side of sides){side.entries=entries.map(entry=>({...entry}));side.frame.bind(side.entries,true);side.scene.sizeViewport(900,900,1,new Float64Array(6));}
  let now=0,isometric=false,turned=0,frontal=0,diagonal=0,differs=0;
  for(let step=0;step<2500;step++){
   now+=next()*40;
   if(next()<.04){isometric=!isometric;const animate=next()<.85;for(const side of sides)side.scene.setMode(isometric,animate,now,0);}
   if(isometric&&next()<.1){const zoom=1+next()*2,x=(next()-.5)*200,y=(next()-.5)*200,moving=next()<.5;for(const side of sides)if(side.scene.canInspect())side.scene.setInspection(zoom,x,y,moving);}
   if(next()<.03)shelfWasm.memory.grow(1);
   // Lifted, dragged and resting entries: a lift and a drag move along the room's inverse turn.
   const writes=[];
   for(let index=0;index<count;index++)if(next()<.2){
    const bits=(next()<.4?2:0)|(next()<.4?4:0)|(next()<.2?8:0);
    writes.push([index*S+2,bits],[index*S+3,(next()-.5)*300],[index*S+4,(next()-.5)*300],[index*S+23,next()*600],[index*S+24,next()*900],[index*S+25,8+next()*30],[index*S+26,120+next()*90],
     [index*S,index%7===3?1:index%7===5?2:0]);
   }
   const trash=next()<.5?new Float64Array([-30,0,-30,30,80,30,700,-900,40]):EMPTY,rooftop=next()<.3?next()*200:-Infinity;
   const results=sides.map(side=>{
    const {scene,frame,out}=side;
    frame.refresh();for(const [at,value] of writes)frame.state[at]=value;
    scene.beginFrame(now);
    // (`transformShown` is this fit with its diagnostics written to a canvas.)
    scene.transformFresh(trash,rooftop,true,1,out);
    const turn=referenceInverseTurn(furniture,out,inverseRotation,inverseTurn);
    if(side.name==='wrong')turn[1]+=1e-9;
    scene.beginEntries(now,false,out[2],side.name==='view'?EMPTY:turn,1,600,0,44);
    side.motionFrame.prepare(side.entries,[],600,1000);
    frame.poses(side.motionFrame.native,scene,side.roomMotion,side.roomTransition,now,false,room);
    return bytes(frame.state)+bytes(frame.output);
   });
   expect(results[1]===results[0],`step ${step}: the view's inverse turn is not the host's`).toBe(true);
   if(results[2]!==results[0])differs++;
   const progress=sides[0].scene.progress;
   if(progress>0&&progress<1)turned++;else if(progress===0)frontal++;else diagonal++;
  }
  // Every stage of the turn was seen, and the poses do depend on the quaternion.
  expect(turned).toBeGreaterThan(300);expect(frontal).toBeGreaterThan(100);expect(diagonal).toBeGreaterThan(100);
  expect(differs).toBeGreaterThan(1000);
 }finally{for(const side of sides){side.frame.free();side.scene.free();side.motionFrame.free();side.roomMotion.free();side.roomTransition.free();}}
});

it('registers the solver\'s keys and resets the style history with the layout, as the frames did',()=>{
 const next=random(77);
 for(let session=0;session<300;session++){
  // The natives as recorders: what each was last told, and when.
  const told={host:{keys:null,resets:[]},live:{keys:null,resets:[]}};
  const recorder=side=>({RustGravityFrame:class{register(keys){told[side].keys=keys.join();}free(){}},
   RustSceneProjectionFrame:class{reset_entries(length){told[side].resets.push(length);}free(){}}});
  const hostGravity=createGravityFrame(recorder('host')),hostProjection=createSceneProjectionFrame(recorder('host'));
  const live=recorder('live'),gravityFrame=new live.RustGravityFrame(),projectionFrame=new live.RustSceneProjectionFrame();
  const settleBooks=next()<.8;
  let physicsReady=next()<.5,physicsStarted=false,serial=0,bookEntries=[];
  // The scene's own lines (src/js/bookshelf-scene.js bindEntries).
  const bindEntries=()=>{
   projectionFrame.reset_entries(bookEntries.length);
   if(settleBooks)gravityFrame.register(bookEntries.map(entry=>entry.key));
  };
  const layout=()=>{
   const kept=bookEntries.filter(()=>next()>.2);
   for(let add=Math.floor(next()*4);add>0;add--)kept.splice(Math.floor(next()*(kept.length+1)),0,{key:`book:${serial++}`});
   // A retained entry can take another key in a layout (its index was its key).
   for(const entry of kept)if(next()<.05)entry.key=`book:${serial++}`;
   bookEntries=kept;
   if(next()<.3)physicsReady=!physicsReady;
   bindEntries();
  };
  layout();
  let frames=0,physics=0;
  for(let step=0;step<60;step++){
   if(next()<.25){layout();continue;}
   const usePhysics=settleBooks&&(physicsReady||physicsStarted);
   if(usePhysics)physicsStarted=true;
   referenceFrameRegistrations(hostProjection,hostGravity,bookEntries,usePhysics);
   frames++;
   // By the time a frame reads them, both hold the same: the keys when the solver steps, and a
   // history that was reset for this layout's entries and for no other since.
   if(usePhysics){physics++;expect(told.live.keys,`session ${session} step ${step}`).toBe(told.host.keys);}
   expect(told.live.resets.at(-1)).toBe(told.host.resets.at(-1));
   expect(told.live.resets.at(-1)).toBe(bookEntries.length);
  }
  expect(frames).toBeGreaterThan(20);
  if(!settleBooks)expect(told.live.keys).toBe(null);
  void physics;
 }
});
