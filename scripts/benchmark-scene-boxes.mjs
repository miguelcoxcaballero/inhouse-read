// What the arena and the view answer themselves, against a 1.7.339 build and its host code
// (tests/unit/helpers/reference-scene-boxes.js):
//  - a layout's boxes: one call and two copies per entry and six numbers written per row, or one
//    mark per row and the boxes taken by the pose call (which is on both sides);
//  - a frame at rest: the room's world matrix copied from three's array before the pose call, or
//    taken by the call from the view's last fit;
//  - the hit stage with every model culled: the stand-in box copied per entry, or the row's own;
//  - the shadow's bounds under a matrix handed over, or under the view's own;
//  - the bin at rest: 27 numbers gathered from three and compared in JavaScript after the bin's
//    frame began, or the view's own answer in that call.
// Node/WASM, no DOM or GPU. Interleaved rounds, medians.
// node scripts/benchmark-scene-boxes.mjs <dir of a 1.7.339 shelf build> <its src/js/scene-entry-frame.js> [dir with the current build]
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {referencePlaceBoxes,referenceFallbackBox,createReferenceBinStands} from '../tests/unit/helpers/reference-scene-boxes.js';
import {referencePositionTrash,referenceRoom} from '../tests/unit/helpers/reference-scene-bin.js';
const load=async dir=>{const rust=await import(pathToFileURL(resolve(dir)+'/inhouse_read_shelf.js').href);rust.initSync({module:readFileSync(resolve(dir)+'/inhouse_read_shelf_bg.wasm')});return rust;};
const old=await load(process.argv[2]),rust=await load(process.argv[4]||'src/wasm/shelf');
const before=await import(pathToFileURL(resolve(process.argv[3])).href),after=await import('../src/js/scene-entry-frame.js');
const {createSceneMotionFrame}=await import('../src/js/scene-motion-frame.js');
const {createSceneProjectionFrame}=await import('../tests/unit/helpers/scene-projection-frame.js');
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
function side(module,api,count){
 const scene=new module.RustScene(600,1200,600,250,false,true,0),roomMotion=new module.RustRoomMotion(),roomTransition=new module.RustRoomTransition();
 const motionFrame=createSceneMotionFrame(module,()=>null),projection=createSceneProjectionFrame(module),frame=api.createSceneEntryFrame(module),S=api.ENTRY_STATE,H=api.HIT_INPUT;
 const entries=Array.from({length:count},(_,i)=>{const kind=i%12===3?'lamp':i%12===7?'plant':undefined;
  return {kind,shelf:i%3,x:20+(i*37)%560,y:200+(i%3)*300,width:kind?45:12,height:kind?90:200,thickness:kind?undefined:150,depth:kind?60:undefined,row:-1};});
 frame.bind(entries,true);projection.prepare(entries);
 scene.sizeViewport(1400,1400,2,new Float64Array(6));scene.measureFit(844,60,760,60,0,false);
 const furniture=new THREE.Group(),parent=new THREE.Scene(),out=new Float64Array(8);parent.add(furniture);
 scene.transformFresh(EMPTY,-Infinity,true,1,out);referenceRoom(furniture,out);
 frame.refresh();
 entries.forEach((entry,index)=>{const at=index*S,state=frame.state,kind=entry.kind==='plant'?1:entry.kind==='lamp'?2:0;referencePlaceBoxes(module,entry);
  state[at]=kind;state[at+23]=entry.x;state[at+24]=entry.y;state[at+25]=entry.width;state[at+26]=entry.height;state[at+27]=entry.depth;state.set(entry.box,at+50);state[at+40]=kind?entry.width:entry.thickness;
  frame.hitInput[index*H]=1|32;frame.hitInput.set(referenceFallbackBox(entry,kind===2),index*H+2);});
 let now=16;
 scene.beginEntries(now,false,out[2],EMPTY,2,600,0,44);motionFrame.prepare(entries,[],600,1000);
 return {module,scene,frame,projection,entries,furniture,S,H,out,poses:room=>frame.poses(motionFrame.native,scene,roomMotion,roomTransition,now,false,room)};
}
for(const count of [40,120,300]){
 const a=side(old,before,count),b=side(rust,after,count);
 a.poses(a.furniture.matrixWorld);b.poses();
 a.frame.refresh();b.frame.refresh();
 for(let index=0;index<count;index++)for(let column=29;column<69;column++)assert.ok(Object.is(a.frame.state[index*a.S+column],b.frame.state[index*b.S+column]),`row ${index} column ${column}`);
 rounds(`${count} entries, a frame at rest (the room's matrix and the pose call)`,'us per frame',4000,()=>a.poses(a.furniture.matrixWorld),()=>b.poses());
 rounds(`${count} entries, a layout's boxes and the pose call that follows`,'us',1500,
  ()=>{a.frame.refresh();const state=a.frame.state;a.entries.forEach((entry,index)=>{referencePlaceBoxes(a.module,entry);state.set(entry.box,index*a.S+50);});a.poses(a.furniture.matrixWorld);},
  ()=>{b.frame.refresh();const state=b.frame.state;for(let index=0;index<count;index++)state[index*b.S+49]=1;b.poses();});
 const hitsA=()=>{a.frame.refresh();const hits=a.frame.hitInput;a.entries.forEach((entry,index)=>{hits.set(referenceFallbackBox(entry,entry.kind==='lamp'),index*a.H+2);hits[index*a.H]=1|32;});a.frame.hits(a.projection.native,a.scene);};
 const hitsB=()=>{b.frame.refresh();const hits=b.frame.hitInput;for(let index=0;index<count;index++)hits[index*b.H]=1|160;b.frame.hits(b.projection.native,b.scene);};
 hitsA();hitsB();a.frame.refresh();b.frame.refresh();
 assert.deepEqual([...b.frame.hitOutput],[...a.frame.hitOutput]);
 rounds(`${count} entries, the hit stage with every model culled`,'us per frame',3000,hitsA,hitsB);
}
{
 const a=side(old,before,1),b=side(rust,after,1),shadowA=new Float64Array(6),shadowB=new Float64Array(6);
 rounds('the shadow\'s bounds','us per frame',40000,()=>a.scene.shadowBounds(EMPTY,a.furniture.matrixWorld.elements,shadowA),()=>b.scene.shadowBounds(EMPTY,EMPTY,shadowB));
 assert.deepEqual([...shadowB],[...shadowA]);
 // The bin at rest in the diagonal view.
 const trash=new THREE.Group(),twin=new THREE.Group(),wall=new THREE.Object3D();trash.userData.radius=twin.userData.radius=44;trash.userData.height=twin.userData.height=140;wall.position.z=-260;
 const bounds=new THREE.Box3(new THREE.Vector3(-48,-1,-60),new THREE.Vector3(48,150,48));
 referencePositionTrash(a.scene,trash,bounds,wall,-1160,12);rust.scene_position_trash(b.scene,twin,bounds,wall,-1160,12);
 b.scene.transformFresh(EMPTY,-Infinity,true,1,b.out);
 const stands=createReferenceBinStands(a.furniture);
 let taken=0,liveStale=true;
 rounds('the bin at rest (its frame begins and whether its box stands)','us per frame',40000,
  i=>{a.scene.trashBegin(i,false);if(!stands.stands(trash,a.scene.trashOpenness))taken++;},
  i=>{const begun=b.scene.trashBegin(i,false);if(begun&4||liveStale){liveStale=false;taken+=b.scene.trashOpenness+1;}});
 assert.equal(taken,2);
}
