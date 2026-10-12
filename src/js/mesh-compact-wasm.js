import * as THREE from 'three';
import {getRustCore} from './rust-core.js';
export function rustCompactGeometry(source){
 const core=getRustCore();if(typeof core?.mesh_compact!=='function'||source.index)return undefined;
 const attributes=Object.entries(source.attributes),count=source.getAttribute('position')?.count;
 if(!Number.isInteger(count)||count<1||count>1_000_000||attributes.length<1||attributes.length>16)return undefined;
 let total=0;const descriptors=[];
 for(const [name,attribute] of attributes){
  if(!(attribute.array instanceof Float32Array)||attribute.count!==count||!Number.isInteger(attribute.itemSize)||attribute.itemSize<1||attribute.itemSize>16)return undefined;
  descriptors.push(total,attribute.itemSize,name==='normal'?1:name==='color'?2:0);total+=attribute.array.length;
 }
 if(total>32*count)return undefined;
 const descriptorOffset=total,inputWords=total+descriptors.length,originalOffset=inputWords,indexOffset=inputWords+count,outputOffset=0;
 const length=Math.ceil((inputWords+2*count)/2);let pointer;
 try{
  pointer=core.alloc_f64(length);if(!pointer)return undefined;
  const data=new Float32Array(core.memory.buffer,pointer,total);let offset=0;
  for(const [,attribute] of attributes){data.set(attribute.array,offset);offset+=attribute.array.length;}
  new Uint32Array(core.memory.buffer,pointer+descriptorOffset*4,descriptors.length).set(descriptors);
  const unique=core.mesh_compact(pointer,total,pointer+descriptorOffset*4,attributes.length,count,pointer+originalOffset*4,pointer+indexOffset*4,pointer+outputOffset*4);
  if(!Number.isInteger(unique)||unique<1||unique>count)return undefined;
  const geometry=new THREE.BufferGeometry();offset=0;
  for(const [name,attribute] of attributes){
   const ArrayType=name==='normal'?Int16Array:name==='color'?Uint8Array:Float32Array,normalized=name==='normal'||name==='color';
   const view=new Float32Array(core.memory.buffer,pointer+(outputOffset+offset)*4,unique*attribute.itemSize);
   geometry.setAttribute(name,new THREE.BufferAttribute(new ArrayType(view),attribute.itemSize,normalized));offset+=attribute.array.length;
  }
  const IndexType=unique>65535?Uint32Array:Uint16Array;
  geometry.setIndex(new THREE.BufferAttribute(new IndexType(new Uint32Array(core.memory.buffer,pointer+indexOffset*4,count)),1));
  geometry.computeBoundingBox();geometry.computeBoundingSphere();return geometry;
 }catch{return undefined;}finally{if(pointer)core.free_f64(pointer,length);}
}
