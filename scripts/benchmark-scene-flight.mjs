// One frame of an entry's flight into the bin, and the bin's button placed from its box, against
// the host code of 1.8.1 (tests/unit/helpers/reference-scene-flight.js): three's world scale and
// turn of the bin, the flight's sample, the slerp, the model's matrices, the slot box's corners and
// the bend, asked one by one; or one native call (rust-ui/src/scene_flight.rs) and the model's
// matrices once. The model is a group of eight meshes, as a shelf book is. Then a frame of the
// bin at rest (the packed rectangle handed over, or none) and a frame that takes the bin's box
// (its corners asked for and packed, or six numbers handed to the view). Node/WASM, no DOM or
// GPU. Interleaved rounds, medians.
// node scripts/benchmark-scene-flight.mjs [dir with the current shelf build]
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {referenceCorners,referenceFlight,referenceBinRect} from '../tests/unit/helpers/reference-scene-flight.js';
import {trashDropRecord} from '../tests/unit/helpers/reference-scene-room.js';
const dir=resolve(process.argv[2]||'src/wasm/shelf');
const rust=await import(pathToFileURL(dir+'/inhouse_read_shelf.js').href);
rust.initSync({module:readFileSync(dir+'/inhouse_read_shelf_bg.wasm')});
const median=a=>a.toSorted((x,y)=>x-y)[Math.floor(a.length/2)];
// shelf-trash.js `sampleTrashDrop`, as the scene imported it.
const sampleTrashDrop=(start,mouth,progress,{height=200,scale=1,endScale=.19}={})=>{
 const [x,y,z,size,turn,fall]=rust.sample_trash_drop(start.x,start.y,start.z,mouth.x,mouth.y,mouth.z,progress,height,scale,endScale);
 return {position:start.clone().set(x,y,z),scale:size,turn,fall};
};
const STATE=117,corners=referenceCorners(rust),overflow=new Float64Array(2),flight=new Float64Array(8),NONE=new Float64Array(0);
const native=new rust.RustSceneEntryFrame();native.resize(3);
const state=()=>new Float64Array(native.memory().buffer,native.state_ptr(),3*STATE);
const entry={row:1,width:120,height:190},slot=[-61,-95,-80,61,95,6];
state().set([entry.width,entry.height],STATE+25);state().set(slot,STATE+50);
const side=()=>{
 const scene=new THREE.Scene(),furniture=new THREE.Group(),trash=new THREE.Group();scene.add(furniture);furniture.add(trash);
 furniture.rotation.set(.12,-.6,0);furniture.scale.setScalar(.82);furniture.position.set(40,-30,0);
 trash.position.set(420,-1120,-30);trash.userData.radius=44;
 trash.userData.getMouth=()=>new THREE.Vector3(0,133,0).applyMatrix4(trash.matrixWorld);
 const model=new THREE.Group();for(let i=0;i<8;i++){const mesh=new THREE.Object3D();mesh.position.set(i,2*i,-i);model.add(mesh);}
 model.position.set(360,-420,20);model.quaternion.setFromEuler(new THREE.Euler(.1,.4,-.2));model.scale.setScalar(.82);scene.add(model);
 scene.updateMatrixWorld(true);
 return {scene,trash,model};
};
const a=side(),b=side();
const dropA=trashDropRecord(()=>{},0,false,850,a.model,{userData:{openness:0}});
const dropB=rust.scene_trash_drop_record(THREE,()=>{},0,false,850,b.model,{userData:{openness:0}});
const hostEntry={...entry,model:a.model};
const previous=(t,width)=>referenceFlight(rust,corners,sampleTrashDrop,a.trash,dropA,hostEntry,slot,t,width,overflow);
const current=(t,width)=>{
 const {trash,model}=b,mouth=trash.userData.getMouth();
 native.binFlight(entry.row,dropB.flight,trash.matrixWorld.elements,mouth.x,mouth.y,mouth.z,trash.userData.radius,t,width,flight);
 model.position.set(flight[0],flight[1],flight[2]);model.scale.setScalar(flight[3]);
 model.quaternion.set(flight[4],flight[5],flight[6],flight[7]);
 model.updateMatrixWorld(true);
};
for(const width of [900,300])for(let i=0;i<=40;i++){
 previous(i/40,width);current(i/40,width);
 assert.deepEqual([...b.model.matrixWorld.elements,...b.model.children[7].matrixWorld.elements],[...a.model.matrixWorld.elements,...a.model.children[7].matrixWorld.elements]);
}
const run=(work,width)=>{const start=performance.now();for(let i=0;i<20000;i++)work((i%53)/52,width);return (performance.now()-start)/20000*1000;};
for(const [label,width] of [['inside the canvas',900],['bent inward (narrow canvas)',300]]){
 for(let i=0;i<3;i++){run(previous,width);run(current,width);}
 const before=[],after=[];
 for(let round=0;round<21;round++){before.push(run(previous,width));after.push(run(current,width));}
 console.log(`flight frame, ${label}: ${median(before).toFixed(3)} -> ${median(after).toFixed(3)} us`);
}
// The bin's button.
const view=()=>{const scene=new rust.RustScene(600,1200,600,250,false,true,0);scene.measureFit(844,60,760,60,0,false);scene.sizeViewport(700,844,2,new Float64Array(6));
 scene.frameLayout(20,10,30,0,40,700,800,900,844,NaN);return scene;};
const host=view(),live=view(),bin=new THREE.Mesh(new THREE.BoxGeometry(90,150,90)),box=new THREE.Box3(),packed=new Float64Array(6),outs=[new Float64Array(6),new Float64Array(6)];
bin.position.set(420,-900,-30);bin.updateMatrixWorld(true);
const takeBefore=()=>{referenceBinRect(corners,box,bin,packed);host.trashPlaced(packed,outs[0]);};
const takeAfter=()=>{const {min,max}=box.setFromObject(bin);live.binBox(min.x,min.y,min.z,max.x,max.y,max.z);live.trashPlaced(NONE,outs[1]);};
const restBefore=()=>host.trashPlaced(packed,outs[0]),restAfter=()=>live.trashPlaced(NONE,outs[1]);
takeBefore();takeAfter();assert.deepEqual([...outs[1]],[...outs[0]]);
const loop=work=>{const start=performance.now();for(let i=0;i<200000;i++)work();return (performance.now()-start)/200000*1000;};
for(const [label,before,after] of [['bin at rest',restBefore,restAfter],['bin box taken',takeBefore,takeAfter]]){
 for(let i=0;i<3;i++){loop(before);loop(after);}
 const x=[],y=[];
 for(let round=0;round<21;round++){x.push(loop(before));y.push(loop(after));}
 console.log(`${label}: ${median(x).toFixed(4)} -> ${median(y).toFixed(4)} us`);
}
