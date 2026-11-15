// @vitest-environment node
import {expect,it} from 'vitest';
import * as THREE from 'three';
import {rustShelf as rust} from './helpers/rust-shelf-ready.js';
import {referencePositionTrash,referencePackBin,referenceRoom,referenceBinNumbers} from './helpers/reference-scene-bin.js';

// The view keeps the bin from the moment it is placed (rust-ui/src/scene_bin.rs): its fit, the
// shadow's bounds and the bin's diagnostics no longer take the bin from the host in every frame.
// The frozen host code (helpers/reference-scene-bin.js), which packed the bin's box and had three
// move two points into the world for each frame, must leave the same numbers and the same data.
const bits=values=>Array.from(values,value=>Object.is(value,-0)?'-0':String(value));
function random(seed){let s=seed>>>0;return()=>{s=s+0x6d2b79f5|0;let t=Math.imul(s^s>>>15,1|s);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}

it('fits the room, bounds the shadow and shows the bin as the host\'s per-frame numbers did',()=>{
 const NONE=new Float64Array(0);
 let withBin=0,without=0,turning=0,replaced=0,written=0;
 for(let trial=0;trial<16;trial++){
  const next=random(trial*7919+5),baggebo=trial%3===0;
  const make=()=>{const scene=new rust.RustScene(600,1200,600+trial*30,250,baggebo,trial%2===0,0);scene.measureFit(844,60,760,60,0,trial%4===0);return scene;};
  const host=make(),live=make();
  const canvases=[{},{}],nodes=[{},{}];
  host.shows(canvases[0]);live.shows(canvases[1]);host.binShows(nodes[0]);live.binShows(nodes[1]);
  for(const scene of [host,live])scene.labels('walnut','600 x 250 x 1160 mm');
  const furniture=new THREE.Group(),parent=new THREE.Scene();parent.add(furniture);
  const wall=new THREE.Object3D(),binBox=new Float64Array(9),numbers=new Float64Array(17);
  const outs=[new Float64Array(8),new Float64Array(8)],shadows=[new Float64Array(6),new Float64Array(6)];
  let trash=null,trashBounds=null,floorY=-1160,time=1000;
  const place=()=>{
   // A layout: a bin arrives or is placed again (another floor, wall or footprint), or leaves.
   if(trash&&next()<.25){trash=null;trashBounds=null;rust.scene_position_trash(live,null,null,wall,floorY,12);return;}
   if(!trash||next()<.3){trash=new THREE.Group();trash.userData.radius=[44,30.5,52][Math.floor(next()*3)];trash.userData.height=[140,96.25][Math.floor(next()*2)];
    trash.position.set(3,4,5);trash.rotation.set(.1,.2,.3);trash.scale.setScalar(2);}
   // (One bin in four is taller than the cabinet, one in four deeper and one in five reaches past its far side, so that every edge of its box bounds the fit and the shadow somewhere.)
   trashBounds=new THREE.Box3(new THREE.Vector3(next()<.2?-1500-next()*100:-45-next()*10,-next()*3,-50-next()*30),new THREE.Vector3(45+next()*10,next()<.25?1300+next()*300:140+next()*40,next()<.25?500+next()*200:45+next()*10));
   floorY=-1100-next()*200;wall.position.z=-200-next()*200;
   const twin=new THREE.Group();twin.userData=trash.userData;twin.position.copy(trash.position);
   referencePositionTrash(host,trash,trashBounds,wall,floorY,12);referencePackBin(binBox,trashBounds,trash);
   rust.scene_position_trash(live,twin,trashBounds,wall,floorY,12);
   expect(bits([...twin.position.toArray(),...twin.rotation.toArray().slice(0,3),...twin.scale.toArray(),twin.visible]))
    .toEqual(bits([...trash.position.toArray(),...trash.rotation.toArray().slice(0,3),...trash.scale.toArray(),trash.visible]));
   replaced++;
  };
  try{
   if(trial%5!==4)place();
   for(let frame=0;frame<300;frame++){
    const dice=next(),label=`trial ${trial} frame ${frame}`;
    time+=16;
    if(dice<.05){const to=!host.isometric,animate=next()<.7;host.setMode(to,animate,time,0);live.setMode(to,animate,time,0);}
    else if(dice<.14){const zoom=1+next()*2,x=(next()-.5)*80,y=(next()-.5)*80,moving=next()<.5;for(const scene of [host,live])scene.setInspection(zoom,x,y,moving);}
    else if(dice<.2)place();
    else if(dice<.24){const hover=next()<.5;for(const scene of [host,live])scene.trashSetHover(hover,true,time);}
    if(host.turning){host.stepTurn(time);live.stepTurn(time);turning++;}
    const rooftop=frame%9?-Infinity:40;
    host.transformShown(trash?binBox:NONE,rooftop,true,1,outs[0]);
    live.transformShown(NONE,rooftop,true,1,outs[1]);
    expect(bits(outs[1]),label).toEqual(bits(outs[0]));
    referenceRoom(furniture,outs[0]);
    host.shadowBounds(trash?binBox:NONE,furniture.matrixWorld.elements,shadows[0]);
    live.shadowBounds(NONE,furniture.matrixWorld.elements,shadows[1]);
    expect(bits(shadows[1]),label).toEqual(bits(shadows[0]));
    if(!trash){host.trashUnshown();live.trashUnshown();without++;}
    else{
     const visible=next()<.8,inFrame=next()<.8,before=JSON.stringify(nodes[0]);
     host.trashShown(referenceBinNumbers(furniture,trash,trashBounds,floorY,numbers),visible,inFrame);
     live.binShown(visible,inFrame);
     withBin++;if(JSON.stringify(nodes[0])!==before)written++;
    }
    for(const pair of [canvases,nodes]){expect(pair[1],label).toEqual(pair[0]);expect(Object.keys(pair[1]),label).toEqual(Object.keys(pair[0]));}
   }
  }finally{host.free();live.free();}
 }
 expect(withBin).toBeGreaterThan(2500);expect(without).toBeGreaterThan(300);expect(turning).toBeGreaterThan(300);
 expect(replaced).toBeGreaterThan(100);expect(written).toBeGreaterThan(800);
});
