import * as THREE from 'three';
const sines=new Float64Array([.44,.05,-.01,.10,.30,.43,.63,.66,1,.66,.63,.43,.30,.10,-.01].map(y=>Math.sin(y*Math.PI)));
const positionOffset=120,normalOffset=472,colorOffset=824,uvOffset=1176,indexOffset=1408,arena=208;

export function rustPlantIvyGeometry(core,{length,width,curve,tint,asymmetry,hue}){
  if(typeof core?.plant_ivy_mesh!=='function'||![length,width,curve,tint,asymmetry,hue].every(v=>Number.isFinite(v)&&Math.abs(v)<=1e6)||length<=0||width<=0)return null;
  let pointer;
  try{pointer=core.alloc_f64(arena);}catch{return null;}
  if(!pointer)return null;
  let geometry;
  try{
    new Float64Array(core.memory.buffer,pointer,15).set(sines);
    if(core.plant_ivy_mesh(length,width,curve,tint,asymmetry,hue,pointer,pointer+positionOffset,
      pointer+normalOffset,pointer+colorOffset,pointer+uvOffset,pointer+indexOffset)!==126)return null;
    const buffer=core.memory.buffer;geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(new Float32Array(buffer,pointer+positionOffset,87),3));
    geometry.setAttribute('color',new THREE.Float32BufferAttribute(new Float32Array(buffer,pointer+colorOffset,87),3));
    geometry.setAttribute('uv',new THREE.Float32BufferAttribute(new Float32Array(buffer,pointer+uvOffset,58),2));
    geometry.setIndex(new THREE.Uint16BufferAttribute(new Uint16Array(buffer,pointer+indexOffset,126),1));
    geometry.setAttribute('normal',new THREE.BufferAttribute(new Float32Array(new Float32Array(buffer,pointer+normalOffset,87)),3));
    geometry.attributes.normal.needsUpdate=true;return geometry;
  }catch{geometry?.dispose();return null;}finally{core.free_f64(pointer,arena);}
}
