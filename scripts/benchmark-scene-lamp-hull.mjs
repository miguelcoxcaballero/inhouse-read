// The standing lamp's hit silhouette per physics frame: the former uncached projection
// (`scene_lamp_hit_hull`) against the retained `RustLampHull` with the lamp at rest (the
// frames of a drag elsewhere, of a scroll) and moving (a turn). Synthetic lamp meshes of a
// size like the catalogue's; no DOM, GPU or battery measurement.
import {readFileSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import * as rust from '../src/wasm/shelf/inhouse_read_shelf.js';
rust.initSync({module:readFileSync(new URL('../src/wasm/shelf/inhouse_read_shelf_bg.wasm',import.meta.url))});
const median=a=>a.toSorted((x,y)=>x-y)[Math.floor(a.length/2)];
function lamp(segments){
 const group=new THREE.Group();
 for(const geometry of [new THREE.CylinderGeometry(40,46,90,segments,4,true),new THREE.CylinderGeometry(6,6,160,segments/4),new THREE.CylinderGeometry(30,34,8,segments),new THREE.SphereGeometry(14,segments/2,segments/4)])
  group.add(new THREE.Mesh(geometry,new THREE.MeshBasicMaterial()));
 group.position.set(200,-300,-40);group.rotation.set(.24,-.5,0);group.updateMatrixWorld(true);return group;
}
const results=[];
for(const segments of [32,96]){
 const model=lamp(segments),hull=new rust.RustLampHull();
 const vertices=model.children.reduce((sum,mesh)=>sum+mesh.geometry.attributes.position.count,0);
 for(const mode of ['resting','moving']){
  let tick=0;
  const frame=()=>{if(mode==='moving'){model.rotation.y=-.5+(tick++%40)*.002;model.updateMatrixWorld(true);}};
  const before=()=>{frame();return rust.scene_lamp_hit_hull(model,180,260);};
  let last=hull.outline(model,180,260,true);const after=()=>{frame();const text=hull.outline(model,180,260,false);if(text!==undefined)last=text;return last;};
  for(let i=0;i<40;i++){tick=i;const a=before();tick=i;assert.equal(after(),a);}
  const time=fn=>{const start=performance.now();for(let i=0;i<40;i++)fn();return (performance.now()-start)/40;};
  const old=[],retained=[];
  for(let round=0;round<21;round++){if(round%2){retained.push(time(after));old.push(time(before));}else{old.push(time(before));retained.push(time(after));}}
  results.push({segments,vertices,mode,uncachedMs:+median(old).toFixed(4),retainedMs:+median(retained).toFixed(4),speedup:+(median(old)/median(retained)).toFixed(1)});
 }
 hull.free();for(const mesh of model.children){mesh.geometry.dispose();mesh.material.dispose();}
}
console.log(JSON.stringify({date:new Date().toISOString(),scope:'lamp hit silhouette per call, Node/WASM, shared host',results},null,1));
