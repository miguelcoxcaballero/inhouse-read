// A frame's dealings with the bin, against the host code of 1.7.339
// (tests/unit/helpers/reference-scene-bin.js): the bin's box packed twice and handed to the
// view's fit and to the shadow's bounds, and the seventeen numbers of its diagnostics gathered
// from three (two points moved into the world) and handed to trashShown; or the same three
// calls with nothing to hand over, since the view keeps the bin from the moment it is placed.
// The fit, the room's turn, the shadow's bounds and the diagnostics' comparison are on both
// sides. Node/WASM, no DOM or GPU (the data attributes are plain objects). Interleaved rounds,
// medians.
// node scripts/benchmark-scene-bin.mjs [dir with the current shelf build]
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {referencePositionTrash,referencePackBin,referenceRoom,referenceBinNumbers} from '../tests/unit/helpers/reference-scene-bin.js';
const dir=resolve(process.argv[2]||'src/wasm/shelf');
const rust=await import(pathToFileURL(dir+'/inhouse_read_shelf.js').href);
rust.initSync({module:readFileSync(dir+'/inhouse_read_shelf_bg.wasm')});
const median=a=>a.toSorted((x,y)=>x-y)[Math.floor(a.length/2)];
const NONE=new Float64Array(0);
const side=()=>{
 const scene=new rust.RustScene(600,1200,600,250,false,true,0);scene.measureFit(844,60,760,60,0,false);
 const canvas={},node={};scene.shows(canvas);scene.binShows(node);scene.labels('walnut','600 x 250 x 1160 mm');
 const furniture=new THREE.Group(),parent=new THREE.Scene();parent.add(furniture);
 const trash=new THREE.Group();trash.userData.radius=44;trash.userData.height=140;
 const trashBounds=new THREE.Box3(new THREE.Vector3(-48,-1,-60),new THREE.Vector3(48,150,48)),wall=new THREE.Object3D();wall.position.z=-260;
 return {scene,canvas,node,furniture,trash,trashBounds,wall,out:new Float64Array(8),shadow:new Float64Array(6)};
};
const a=side(),b=side(),binBox=new Float64Array(9),numbers=new Float64Array(17);
referencePositionTrash(a.scene,a.trash,a.trashBounds,a.wall,-1160,12);
rust.scene_position_trash(b.scene,b.trash,b.trashBounds,b.wall,-1160,12);
const previous=()=>{
 const {scene,furniture,trash,trashBounds,out,shadow}=a;
 referencePackBin(binBox,trashBounds,trash);
 scene.transformShown(binBox,-Infinity,true,1,out);
 referenceRoom(furniture,out);
 referencePackBin(binBox,trashBounds,trash);
 scene.shadowBounds(binBox,furniture.matrixWorld.elements,shadow);
 scene.trashShown(referenceBinNumbers(furniture,trash,trashBounds,-1160,numbers),true,true);
};
const current=()=>{
 const {scene,furniture,out,shadow}=b;
 scene.transformShown(NONE,-Infinity,true,1,out);
 referenceRoom(furniture,out);
 scene.shadowBounds(NONE,furniture.matrixWorld.elements,shadow);
 scene.binShown(true,true);
};
previous();current();
assert.deepEqual(b.canvas,a.canvas);assert.deepEqual(b.node,a.node);assert.deepEqual([...b.out],[...a.out]);assert.deepEqual([...b.shadow],[...a.shadow]);
const olds=[],news=[];
for(let round=0;round<25;round++){
 let t=performance.now();for(let i=0;i<20000;i++)previous();olds.push((performance.now()-t)/20);
 t=performance.now();for(let i=0;i<20000;i++)current();news.push((performance.now()-t)/20);
}
console.log(`a frame at rest with the bin (the fit, the room's turn, the shadow's bounds and the bin's diagnostics): ${median(olds).toFixed(3)} -> ${median(news).toFixed(3)} us per frame (x${(median(olds)/median(news)).toFixed(2)})`);
