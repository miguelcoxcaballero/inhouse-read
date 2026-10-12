import * as THREE from 'three';

/** Subdivide the source without modifying it on an unavailable/rejected core. */
export function rustPlantSubdivide(core,surface){
  const position=surface?.attributes?.position,index=surface?.index;
  const vertices=position?.count,count=index?.count;
  if(typeof core?.plant_subdivide!=='function'||!Number.isInteger(vertices)||!Number.isInteger(count)
    ||vertices<3||count<3||count%3||vertices+count>65535||position.itemSize!==3
    ||!(position.array instanceof Float32Array)||!(index.array instanceof Uint16Array))return false;
  const align=n=>Math.ceil(n/8)*8;
  const sourceOffset=0,indexOffset=align(vertices*3*4),positionOffset=indexOffset+align(count*2);
  const outputOffset=positionOffset+align((vertices+count)*3*4),arena=(outputOffset+align(count*4*2))/8;
  let pointer;
  try{pointer=core.alloc_f64(arena);}catch{return false;}
  if(!pointer)return false;
  try{
    new Float32Array(core.memory.buffer,pointer+sourceOffset,vertices*3).set(position.array);
    new Uint16Array(core.memory.buffer,pointer+indexOffset,count).set(index.array);
    const length=core.plant_subdivide(vertices,count,pointer,pointer+indexOffset,pointer+positionOffset,pointer+outputOffset);
    if(length<vertices||length>vertices+count)return false;
    const points=new THREE.Float32BufferAttribute(new Float32Array(core.memory.buffer,pointer+positionOffset,length*3),3);
    const triangles=new THREE.Uint16BufferAttribute(new Uint16Array(core.memory.buffer,pointer+outputOffset,count*4),1);
    surface.setAttribute('position',points);surface.setIndex(triangles);return true;
  }catch{return false;}finally{core.free_f64(pointer,arena);}
}
