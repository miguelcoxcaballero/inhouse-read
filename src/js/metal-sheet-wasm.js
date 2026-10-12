import * as THREE from 'three';
import {getRustCore} from './rust-core.js';
export function rustExpandedMetal(uMin,uMax,vMin,vMax,kind,z,pitch,periodY,strand,thickness){
 const core=getRustCore();if(!['metal_sheet_prepare','metal_sheet_count','metal_sheet_data','metal_sheet_free'].every(name=>typeof core?.[name]==='function')||![0,1].includes(kind))return undefined;
 const parameters=[uMin,uMax,vMin,vMax,pitch,periodY,strand,thickness,z];if(!parameters.every(Number.isFinite))return undefined;
 let pointer,handle;
 try{
  pointer=core.alloc_f64(parameters.length);if(!pointer)return undefined;
  new Float64Array(core.memory.buffer,pointer,parameters.length).set(parameters);
  handle=core.metal_sheet_prepare(pointer,kind);if(!handle)return undefined;
  const count=core.metal_sheet_count(handle);if(!Number.isInteger(count)||count<1||count>500000)return undefined;
  const positions=core.metal_sheet_data(handle,0),uvs=core.metal_sheet_data(handle,1);if(!positions||!uvs)return undefined;
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(new Float32Array(core.memory.buffer,positions,count*3),3));
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute(new Float32Array(core.memory.buffer,uvs,count*2),2));
  const normals=core.metal_sheet_data(handle,2);if(!normals){geometry.dispose();return undefined;}
  const normal=new THREE.BufferAttribute(new Float32Array(new Float32Array(core.memory.buffer,normals,count*3)),3);normal.needsUpdate=true;geometry.setAttribute('normal',normal);return geometry;
 }catch{return undefined;}finally{if(handle)core.metal_sheet_free(handle);if(pointer)core.free_f64(pointer,parameters.length);}
}
