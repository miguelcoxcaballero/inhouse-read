// @vitest-environment node
import {expect,it} from 'vitest';
import * as THREE from 'three';
import {rustShelf as rust,shelfWasm} from './helpers/rust-shelf-ready.js';
import {createSceneEntryFrame,ENTRY_STATE,HIT_INPUT} from '../../src/js/scene-entry-frame.js';
import {createSceneMotionFrame} from './helpers/scene-motion-frame.js';
import {createSceneProjectionFrame} from './helpers/scene-projection-frame.js';
import {referencePlaceBoxes,referenceFallbackBox,createReferenceBinStands} from './helpers/reference-scene-boxes.js';
import {referencePositionTrash,referenceRoom} from './helpers/reference-scene-bin.js';

// The arena takes each row's slot box in the pose call and its stand-in box in the hit stage from
// the row's own columns, the pose call and the shadow's bounds take the room of the view's last
// fit, and the view says whether the bin's box on screen has to be taken again. The frozen host
// code (helpers/reference-scene-boxes.js), which kept two boxes per entry, handed three's matrix
// over and compared 27 numbers of the bin in every frame, must give the same bits and answers.
const S=ENTRY_STATE;
const bytes=values=>Buffer.from(values.buffer,values.byteOffset,values.byteLength).toString('hex');
function random(seed){let s=seed>>>0;return()=>{s=s+0x6d2b79f5|0;let t=Math.imul(s^s>>>15,1|s);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}

it('takes the boxes and the room itself as the host handed them over',()=>{
 let frames=0,culled=0,surfaces=0,resized=0,turned=0;
 for(let session=0;session<24;session++){
  const next=random(session*6151+3),EMPTY=new Float64Array(0);
  // `host` writes its boxes and three's room matrix as before, `live` marks the rows and hands nothing.
  const sides=['host','live'].map(name=>({name,scene:new rust.RustScene(600,900,600,250,false,session%2===0,0),frame:createSceneEntryFrame(rust),projection:createSceneProjectionFrame(rust),
   motionFrame:createSceneMotionFrame(rust,()=>null),roomMotion:new rust.RustRoomMotion(),roomTransition:new rust.RustRoomTransition(),out:new Float64Array(8),shadow:new Float64Array(6)}));
  const furniture=new THREE.Group(),parent=new THREE.Scene();parent.add(furniture);
  let serial=0;
  const size=entry=>{
   entry.width=entry.kind?30+next()*60:6+next()*14;entry.height=60+next()*160;
   entry.thickness=entry.kind?next()<.5?undefined:next()*40:90+next()*90;
   entry.depth=next()<.3?undefined:next()<.1?0:20+next()*120;
   entry.x=next()*600;entry.y=next()*900;
   referencePlaceBoxes(rust,entry);
  };
  const make=()=>{const dice=next(),kind=dice<.15?'plant':dice<.3?'lamp':undefined;
   const entry={id:serial++,kind,mount:kind==='lamp'&&next()<.4?'undershelf':next()<.05?'undershelf':undefined,row:-1,node:next()<.9,surface:null,stale:true};size(entry);return entry;};
  try{
   let entries=[],now=0,isometric=session%2===0;
   const layout=()=>{
    const kept=entries.filter(()=>next()>.15);
    for(let index=kept.length-1;index>0;index--){const other=Math.floor(next()*(index+1));[kept[index],kept[other]]=[kept[other],kept[index]];}
    for(let add=Math.floor(next()*6);add>0;add--)kept.splice(Math.floor(next()*(kept.length+1)),0,make());
    // A layout marks every entry (placeBoxes, staticStale).
    for(const entry of kept)if(next()<.5)size(entry);else entry.stale=true;
    entries=kept;
    for(const side of sides){const twins=entries.map(entry=>({row:side.rows?.get(entry.id)??-1}));side.frame.bind(twins,next()<2);side.rows=new Map(entries.map((entry,index)=>[entry.id,index]));side.projection.prepare(twins);}
   };
   layout();
   for(const side of sides)side.scene.sizeViewport(900,900,1,new Float64Array(6));
   for(let step=0;step<90;step++){
    const dice=next();now+=next()*40;
    if(dice<.12)layout();
    if(dice>.9){isometric=!isometric;const animate=next()<.8;for(const side of sides)side.scene.setMode(isometric,animate,now,0);}
    if(next()<.05)shelfWasm.memory.grow(1);
    // Records change a size between frames; a model appears or is culled.
    for(const entry of entries){
     if(next()<.08){size(entry);resized++;}
     if(next()<.2)entry.surface=entry.node&&next()<.6?{box:Array.from({length:6},(_,index)=>(index<3?-1:1)*(2+next()*40)),matrix:Array.from({length:16},()=>(next()-.5)*4)}:null;
    }
    const results=sides.map(side=>{
     const {scene,frame,out,name}=side,host=name==='host';
     scene.beginFrame(now);
     scene.transformFresh(EMPTY,-Infinity,true,1,out);
     referenceRoom(furniture,out);
     scene.beginEntries(now,false,out[2],EMPTY,1,600,0,44);
     side.motionFrame.prepare(entries,[],600,1000);
     frame.refresh();
     const state=frame.state;
     entries.forEach((entry,index)=>{
      if(!entry.stale)return;
      const at=index*S,plant=entry.kind==='plant',lamp=entry.kind==='lamp',undershelf=lamp&&entry.mount==='undershelf',kind=plant?1:lamp?2:0;
      // The scene's own lines for a stale entry (src/js/bookshelf-scene.js updateEntries), then each side's box.
      state[at]=kind;state[at+1]=undershelf?1:0;
      state[at+23]=entry.x;state[at+24]=entry.y;state[at+25]=entry.width;state[at+26]=entry.height;
      state[at+27]=entry.depth;state[at+28]=0;
      if(host)state.set(entry.box,at+50);else state[at+49]=1;
      state[at+40]=kind?entry.width:entry.thickness;
     });
     frame.poses(side.motionFrame.native,scene,side.roomMotion,side.roomTransition,now,false,host?furniture.matrixWorld:undefined);
     frame.refresh();
     const hits=frame.hitInput;
     entries.forEach((entry,index)=>{
      const h=index*HIT_INPUT,lamp=entry.kind==='lamp';
      if(!entry.node){hits[h]=0;return;}
      let placed=host?32:160;
      if(entry.surface){hits.set(entry.surface.box,h+2);hits.set(entry.surface.matrix,h+8);placed=0;}
      else if(host)hits.set(referenceFallbackBox(entry,lamp),h+2);
      hits[h]=1|(lamp&&entry.mount==='undershelf'?2:0)|placed;hits[h+1]=0;
     });
     frame.hits(side.projection.native,scene);
     frame.refresh();
     scene.shadowBounds(EMPTY,host?furniture.matrixWorld.elements:EMPTY,side.shadow);
     // (Column 49 is the mark itself: the pose call has cleared it.)
     return {state:bytes(frame.state),output:bytes(frame.output),hit:bytes(frame.hitOutput),shadow:bytes(side.shadow)};
    });
    for(const key of ['state','output','hit','shadow'])expect(results[1][key]===results[0][key],`session ${session} step ${step}: ${key}`).toBe(true);
    for(const entry of entries){entry.stale=false;if(entry.node){if(entry.surface)surfaces++;else culled++;}}
    frames++;const progress=sides[0].scene.progress;if(progress>0&&progress<1)turned++;
   }
  }finally{for(const side of sides){side.frame.free();side.scene.free();side.projection.free();side.motionFrame.free();side.roomMotion.free();side.roomTransition.free();}}
 }
 expect(frames).toBeGreaterThan(2000);expect(culled).toBeGreaterThan(5000);expect(surfaces).toBeGreaterThan(5000);expect(resized).toBeGreaterThan(1000);expect(turned).toBeGreaterThan(150);
});

it('says that the bin\'s box has to be taken again exactly when the host\'s comparison did',()=>{
 let taken=0,kept=0,drops=0,skipped=0;
 for(let trial=0;trial<20;trial++){
  const next=random(trial*104723+9),NONE=new Float64Array(0);
  const make=()=>{const scene=new rust.RustScene(600,1200,600+trial*20,250,false,trial%2===0,0);scene.measureFit(844,60,760,60,0,false);return scene;};
  const host=make(),live=make(),out=new Float64Array(8),binBox=new Float64Array(9);
  const furniture=new THREE.Group(),parent=new THREE.Scene();parent.add(furniture);
  const wall=new THREE.Object3D(),trash=new THREE.Group(),twin=new THREE.Group();trash.userData.radius=twin.userData.radius=44;trash.userData.height=twin.userData.height=140;
  const bounds=new THREE.Box3(new THREE.Vector3(-48,-1,-60),new THREE.Vector3(48,150,48));
  const stands=createReferenceBinStands(furniture);
  let liveStale=true,time=1000,floorY=-1160,dropLeft=0;
  const place=()=>{
   // Placed again where it stood (a layout that changes nothing of it), or elsewhere.
   if(next()<.5){const which=Math.floor(next()*3);if(which===0)floorY=-1100-next()*200;else if(which===1)wall.position.z=-200-next()*200;else trash.userData.radius=twin.userData.radius=30+next()*30;}
   referencePositionTrash(host,trash,bounds,wall,floorY,12);rust.scene_position_trash(live,twin,bounds,wall,floorY,12);
   const {min,max}=bounds,{position}=trash;binBox.set([min.x,min.y,min.z,max.x,max.y,max.z,position.x,position.y,position.z]);
  };
  try{
   place();
   for(let frame=0;frame<400;frame++){
    const dice=next(),label=`trial ${trial} frame ${frame}`;
    time+=16;
    if(dice<.04){const to=!host.isometric,animate=next()<.7;host.setMode(to,animate,time,0);live.setMode(to,animate,time,0);
     // Leaving the diagonal view closes the bin and asks for its box again.
     if(!to){for(const scene of [host,live])scene.trashReset();stands.binStale=true;liveStale=true;}}
    else if(dice<.1){const zoom=1+next()*2,x=(next()-.5)*80,y=(next()-.5)*80,moving=next()<.5;for(const scene of [host,live])scene.setInspection(zoom,x,y,moving);}
    else if(dice<.16)place();
    else if(dice<.24){const hover=next()<.5;for(const scene of [host,live])scene.trashSetHover(hover,true,time);}
    else if(dice<.28&&!dropLeft)dropLeft=1+Math.floor(next()*6);
    if(host.turning){host.stepTurn(time);live.stepTurn(time);}
    host.transformFresh(binBox,-Infinity,true,1,out);live.transformFresh(NONE,-Infinity,true,1,out);
    referenceRoom(furniture,out);
    // A frame without the bin's button does not look at the bin at all.
    if(next()<.06){skipped++;continue;}
    const reduced=next()<.1,begun=[host.trashBegin(time,reduced),live.trashBegin(time,reduced)];
    expect(begun[1]&3,label).toBe(begun[0]&3);
    const drop=dropLeft>0;
    if(drop){dropLeft--;drops++;stands.binStale=true;liveStale=true;}
    // The host's lines (updateTrash, 1.7.339) and the scene's own.
    const before=drop||!stands.stands(trash,host.trashOpenness);
    const after=Boolean(drop||begun[1]&4||liveStale);
    if(after&&!drop)liveStale=false;
    expect(after,label).toBe(before);
    if(before)taken++;else kept++;
   }
  }finally{host.free();live.free();}
 }
 expect(taken).toBeGreaterThan(1500);expect(kept).toBeGreaterThan(1500);expect(drops).toBeGreaterThan(300);expect(skipped).toBeGreaterThan(200);
});
