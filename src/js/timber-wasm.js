import * as THREE from 'three';
import {getRustCore} from './rust-core.js';
const VERTICES=132,FLOATS=VERTICES*11;
let lipCaps;
function build(kind,parameters){
 const core=getRustCore();if(typeof core?.timber_mesh!=='function')return undefined;
 if(!parameters.every(Number.isFinite))return undefined;
 const length=parameters.length+FLOATS/2;let pointer;
 try{
  pointer=core.alloc_f64(length);if(!pointer)return undefined;
  new Float64Array(core.memory.buffer,pointer,parameters.length).set(parameters);
  const output=pointer+parameters.length*8;if(core.timber_mesh(pointer,kind,output)!==VERTICES)return undefined;
  const values=new Float32Array(core.memory.buffer,output,FLOATS);if(!values.every(Number.isFinite))return undefined;
  const geometry=new THREE.BufferGeometry();
  // Float32BufferAttribute copies the typed view. GPU uploads must never hold
  // pointers into an arena freed or moved by a subsequent WASM allocation.
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(values.subarray(0,VERTICES*3),3));
  geometry.setAttribute('normal',new THREE.Float32BufferAttribute(values.subarray(VERTICES*3,VERTICES*6),3));
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute(values.subarray(VERTICES*6,VERTICES*8),2));
  geometry.setAttribute('color',new THREE.Float32BufferAttribute(values.subarray(VERTICES*8),3));
  geometry.computeBoundingBox();geometry.computeBoundingSphere();return geometry;
 }catch{return undefined;}finally{if(pointer)core.free_f64(pointer,length);}
}
export function rustChamferedTimber(width,height,depth,bevel,grain,offset,tone){
 if(offset?.length!==2||tone?.length!==3)return undefined;
 return build(0,[width,height,depth,bevel,grain,...offset,...tone]);
}
export function rustShelfLip(width,offset,tone){
 if(typeof getRustCore()?.timber_mesh!=='function'||offset?.length!==2||tone?.length!==3)return undefined;
 if(!lipCaps){
  const contour=[[6,0],[9,0],[10.25,-.3],[11.1,-1],[11.55,-2],[11.7,-3.2],
   [11.7,-12.2],[11.5,-13.35],[10.9,-14.3],[9.9,-14.85],[8.8,-15],[6,-15]].map(([z,y])=>new THREE.Vector2(z,y));
  lipCaps=THREE.ShapeUtils.triangulateShape(contour,[]).flat();
 }
 if(lipCaps.length!==30)return undefined;
 return build(1,[width,15,12,0,0,...offset,...tone,...lipCaps]);
}
