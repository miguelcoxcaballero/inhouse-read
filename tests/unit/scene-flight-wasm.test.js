// @vitest-environment node
import {expect,it} from 'vitest';
import * as THREE from 'three';
import {rustShelf as rust} from './helpers/rust-shelf-ready.js';
import {sampleTrashDrop} from '../../src/js/shelf-trash.js';
import {createSceneEntryFrame,ENTRY_STATE} from '../../src/js/scene-entry-frame.js';
import {referenceCorners,referenceFlight,referenceBinRect} from './helpers/reference-scene-flight.js';
import {trashDropRecord} from './helpers/reference-scene-room.js';

// An entry's flight into the bin is one native call per frame (rust-ui/src/scene_flight.rs) and the
// bin's box on screen is kept by the view (scene_bin.rs `binBox`). The frozen host code of 1.8.1
// (helpers/reference-scene-flight.js), which asked three for the bin's world scale and turn, slerped
// the model's quaternion, updated its matrices and asked four natives in turn, must leave the same
// position, scale, quaternion and world matrix on the model, bit for bit.
const bits=values=>Array.from(values,value=>Object.is(value,-0)?'-0':String(value));
function random(seed){let s=seed>>>0;return()=>{s=s+0x6d2b79f5|0;let t=Math.imul(s^s>>>15,1|s);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
const posed=model=>bits([...model.position.toArray(),...model.quaternion.toArray(),...model.scale.toArray(),...model.matrixWorld.elements]);

it('flies an entry into the bin as the host\'s three objects and four natives did',()=>{
 const corners=referenceCorners(rust),overflow=new Float64Array(2),flight=new Float64Array(8);
 const frame=createSceneEntryFrame(rust),branches=new Set();
 let frames=0,bent=0,mirrored=0,ended=0,started=0,close=0,opposite=0,same=0;
 try{
  frame.prepare(5);
  for(let trial=0;trial<400;trial++){
   const next=random(trial*104729+11),spread=()=>(next()-.5)*2;
   // The room, turned, scaled and placed as a view may fit it (one in eight mirrored), and the bin in it.
   const scene=new THREE.Scene(),furniture=new THREE.Group(),trash=new THREE.Group();scene.add(furniture);furniture.add(trash);
   const quarter=trial%4;
   furniture.rotation.set(spread()*(quarter===1?3.1:.2),spread()*(quarter===2?3.1:.9),quarter===3?spread()*3.1:0);
   furniture.scale.setScalar(.4+next()*1.4);if(trial%8===7){furniture.scale.x*=-1;mirrored++;}
   furniture.position.set(spread()*300,spread()*600,0);
   trash.position.set(300+spread()*200,-1100+spread()*80,-40+spread()*40);
   trash.userData.radius=[44,30.5,52][trial%3];
   const mouthHeight=120+next()*40;
   trash.userData.getMouth=()=>new THREE.Vector3(0,mouthHeight,0).applyMatrix4(trash.matrixWorld);
   scene.updateMatrixWorld(true);
   // The entry: its size and slot box in the arena's row, and a model flying as a child of the scene.
   const row=trial%5,entry={row,width:8+next()*160,height:120+next()*140};
   const slot=[-entry.width/2-next()*3,-entry.height/2,-70-next()*30,entry.width/2+next()*3,entry.height/2,next()*20];
   frame.refresh();
   frame.state.set([entry.width,entry.height],row*ENTRY_STATE+25);frame.state.set(slot,row*ENTRY_STATE+50);
   const twins=[new THREE.Object3D(),new THREE.Object3D()],turn=new THREE.Euler(spread()*3,spread()*3,spread()*3);
   for(const model of twins){
    model.position.set(200+trial%7*40,-300-trial%11*50,20);model.scale.setScalar(.6+trial%5*.2);model.quaternion.setFromEuler(turn);
    scene.add(model);
   }
   const expected={...entry,model:twins[0]},actual={...entry,model:twins[1]};
   const drops=[trashDropRecord(()=>{},0,false,850,twins[0],{userData:{openness:0}}),rust.scene_trash_drop_record(THREE,()=>{},0,false,850,twins[1],{userData:{openness:0}})];
   // One start in six is the very turn the flight ends in, its negative or a hair from it: slerp's own branches.
   if(trial%6===5){
    const end=trash.getWorldQuaternion(new THREE.Quaternion()).multiply(drops[0].bookQuaternion);
    if(trial%18===5){end.set(-end.x,-end.y,-end.z,-end.w);opposite++;}
    else if(trial%18===11){end.x+=1e-9;close++;}
    else same++;
    drops[0].startQuaternion.copy(end);drops[1].flight.set(end.toArray(),4);
   }
   expect(bits(drops[1].flight)).toEqual(bits([...drops[0].start.toArray(),drops[0].startScale,...drops[0].startQuaternion.toArray(),...drops[0].bookQuaternion.toArray()]));
   const sceneWidth=trial%3?600+next()*600:150+next()*200;
   const times=[0,1,-0,.76,.68,.14,1e-9,...Array.from({length:14},()=>next()),...Array.from({length:4},()=>next()*.14)];
   for(const t of times){
    // The room may turn while the entry flies (never for the starts made to meet the end's turn).
    if(trial%6!==5&&next()<.3){furniture.rotation.y+=spread()*.05;furniture.position.x+=spread()*4;scene.updateMatrixWorld(true);}
    referenceFlight(rust,corners,sampleTrashDrop,trash,drops[0],expected,slot,t,sceneWidth,overflow);
    const mouth=trash.userData.getMouth(),model=actual.model;
    frame.lamp.binFlight(row,drops[1].flight,trash.matrixWorld.elements,mouth.x,mouth.y,mouth.z,trash.userData.radius,t,sceneWidth,flight);
    model.position.set(flight[0],flight[1],flight[2]);model.scale.setScalar(flight[3]);
    model.quaternion.set(flight[4],flight[5],flight[6],flight[7]);
    model.updateMatrixWorld(true);
    expect(posed(model),`trial ${trial} t ${t}`).toEqual(posed(expected.model));
    frames++;if(overflow[0])bent++;if(t===1)ended++;if(Object.is(t,0))started++;
    const m=new THREE.Matrix4().extractRotation(trash.matrixWorld).elements,trace=m[0]+m[5]+m[10];
    branches.add(trace>0?0:m[0]>m[5]&&m[0]>m[10]?1:m[5]>m[10]?2:3);
   }
  }
 }finally{frame.free();}
 expect(frames).toBeGreaterThan(9000);expect(bent).toBeGreaterThan(500);expect(frames-bent).toBeGreaterThan(3000);
 expect(mirrored).toBeGreaterThan(40);expect(ended).toBe(400);expect(started).toBe(400);
 expect(close).toBeGreaterThan(15);expect(opposite).toBeGreaterThan(15);expect(same).toBeGreaterThan(15);
 expect(branches.size).toBe(4);
});

it('places the bin\'s button from the box the view keeps as from the rectangle the host packed',()=>{
 const corners=referenceCorners(rust),NONE=new Float64Array(0),packed=new Float64Array(6),outs=[new Float64Array(6),new Float64Array(6)];
 let shown=0,hidden=0,kept=0;
 for(let trial=0;trial<60;trial++){
  const next=random(trial*31+3);
  const make=()=>{const view=new rust.RustScene(600,1200,600+trial*20,250,trial%3===0,trial%4!==3,0);view.measureFit(844,60,760,60,0,false);view.sizeViewport(700,844,2,new Float64Array(6));return view;};
  const host=make(),live=make();
  const scene=new THREE.Scene(),trash=new THREE.Mesh(new THREE.BoxGeometry(90,150,90)),box=new THREE.Box3();scene.add(trash);
  try{
   for(let frame=0;frame<120;frame++){
    const layout=[next()*40,next()*30,next()*60-20,0,40,600+next()*300,500+next()*400,800+next()*300,844,frame%5?NaN:700+next()*200];
    for(const view of [host,live])view.frameLayout(...layout);
    // The box is taken when the bin moved; otherwise the host kept its packed rectangle and the view its own.
    if(frame===0||next()<.4){
     trash.position.set(next()*900-100,-next()*1400,next()*80-40);trash.scale.setScalar(.3+next()*1.5);trash.rotation.y=next();trash.updateMatrixWorld(true);
     referenceBinRect(corners,box,trash,packed);
     const {min,max}=box.setFromObject(trash);live.binBox(min.x,min.y,min.z,max.x,max.y,max.z);
    }else kept++;
    host.trashPlaced(packed,outs[0]);live.trashPlaced(NONE,outs[1]);
    expect(bits(outs[1]),`trial ${trial} frame ${frame}`).toEqual(bits(outs[0]));
    if(outs[0][0])shown++;else hidden++;
   }
  }finally{host.free();live.free();trash.geometry.dispose();}
 }
 expect(shown).toBeGreaterThan(500);expect(hidden).toBeGreaterThan(500);expect(kept).toBeGreaterThan(2000);
});
