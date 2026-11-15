// The head of a frame, against the host code of 1.7.339 (tests/unit/helpers/reference-scene-bind.js
// and the two adapters that left the app, now tests/unit/helpers/gravity-frame.js and
// scene-projection-frame.js): the room's inverse turn read back from three and handed to the
// entries, the bin's box packed twice and the two registrations asked about, or none of them
// (the view keeps the inverse turn of its own fit, the bin's box is packed when the bin is
// placed and the registrations are a layout's). The fit, the room's turn and beginEntries are
// on both sides. Node/WASM, no DOM or GPU. Interleaved rounds, medians.
// node scripts/benchmark-scene-bind.mjs [dir with the current shelf build]
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
import * as THREE from 'three';
import {referenceInverseTurn,referenceFrameRegistrations,referencePackBin} from '../tests/unit/helpers/reference-scene-bind.js';
import {createGravityFrame} from '../tests/unit/helpers/gravity-frame.js';
import {createSceneProjectionFrame} from '../tests/unit/helpers/scene-projection-frame.js';
const dir=resolve(process.argv[2]||'src/wasm/shelf');
const rust=await import(pathToFileURL(dir+'/inhouse_read_shelf.js').href);
rust.initSync({module:readFileSync(dir+'/inhouse_read_shelf_bg.wasm')});
const median=a=>a.toSorted((x,y)=>x-y)[Math.floor(a.length/2)];
const rounds=(label,unit,times,previous,current)=>{
 const olds=[],news=[];
 for(let round=0;round<25;round++){
  let t=performance.now();for(let i=0;i<times;i++)previous(i);olds.push((performance.now()-t)/times*1000);
  t=performance.now();for(let i=0;i<times;i++)current(i);news.push((performance.now()-t)/times*1000);
 }
 console.log(`${label}: ${median(olds).toFixed(3)} -> ${median(news).toFixed(3)} ${unit} (x${(median(olds)/median(news)).toFixed(2)})`);
};
const EMPTY=new Float64Array(0);
for(const bin of [false,true]){
 const side=()=>{const scene=new rust.RustScene(600,1200,600,250,false,true,0);scene.sizeViewport(900,900,2,new Float64Array(6));
  return {scene,furniture:new THREE.Group(),out:new Float64Array(8)};};
 const a=side(),b=side();
 const entries=Array.from({length:120},(_,index)=>({key:`book:${index}`}));
 const hostGravity=createGravityFrame(rust),hostProjection=createSceneProjectionFrame(rust);
 const inverseRotation=new THREE.Quaternion(),inverseTurn=new Float64Array(4);
 const trash={position:new THREE.Vector3(700,-900,40)},trashBounds=new THREE.Box3(new THREE.Vector3(-30,0,-30),new THREE.Vector3(30,80,30));
 const binA=new Float64Array(9),binB=new Float64Array(9);
 referencePackBin(binB,trashBounds,trash);
 const previous=i=>{
  const {scene,furniture,out}=a;
  if(bin)referencePackBin(binA,trashBounds,trash);
  scene.transformFresh(bin?binA:EMPTY,-Infinity,true,1,out);
  referenceInverseTurn(furniture,out,inverseRotation,inverseTurn);
  scene.beginEntries(i,false,out[2],inverseTurn,2,600,0,44);
  referenceFrameRegistrations(hostProjection,hostGravity,entries,true);
  if(bin)referencePackBin(binA,trashBounds,trash);
 };
 const current=i=>{
  const {scene,furniture,out}=b;
  scene.transformFresh(bin?binB:EMPTY,-Infinity,true,1,out);
  furniture.rotation.set(out[1],out[0],0);
  scene.beginEntries(i,false,out[2],EMPTY,2,600,0,44);
 };
 rounds(`the head of a frame ${bin?'with':'without'} the bin (the fit, the room's turn and beginEntries included)`,'us per frame',20000,previous,current);
 a.scene.free();b.scene.free();hostGravity.free();hostProjection.free();
}
