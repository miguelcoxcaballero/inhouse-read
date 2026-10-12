import * as THREE from 'three';

/** Extrude an already triangulated curved blade; its external source mesh
 * stays owned by the caller, including on a failed native calculation. */
export function rustPlantMonsteraGeometry(core,{length,width,curve,tint,twist,hue,surface}){
  const source=surface?.attributes?.position,index=surface?.index,n=source?.count,count=index?.count;
  if(typeof core?.plant_monstera_mesh!=='function'||!Number.isInteger(n)||!Number.isInteger(count)
    ||n<3||n>32767||count<3||count>65535||count%3||source.itemSize!==3
    ||!(source.array instanceof Float32Array)||!(index.array instanceof Uint16Array)
    ||![length,width,curve,tint,twist,hue].every(v=>Number.isFinite(v)&&Math.abs(v)<=1e6)||length<=0||width<=0)return null;
  let size=0;const span=bytes=>{const at=size;size+=Math.ceil(bytes/8)*8;return at;};
  const sourceOffset=span(n*3*4),sineOffset=span(n*8),triangleOffset=span(count*2);
  const positionOffset=span(n*6*4),normalOffset=span(n*6*4),colorOffset=span(n*6*4),uvOffset=span(n*4*4),indexOffset=span(count*8*2),arena=size/8;
  let pointer;
  try{pointer=core.alloc_f64(arena);}catch{return null;}
  if(!pointer)return null;
  let geometry;
  try{
    const sines=new Float64Array(core.memory.buffer,pointer+sineOffset,n);
    for(let i=0;i<n;i++)sines[i]=Math.sin(source.getY(i)*Math.PI);
    new Float32Array(core.memory.buffer,pointer+sourceOffset,n*3).set(source.array);
    new Uint16Array(core.memory.buffer,pointer+triangleOffset,count).set(index.array);
    const written=core.plant_monstera_mesh(n,count,length,width,curve,tint,twist,hue,
      pointer+sourceOffset,pointer+sineOffset,pointer+triangleOffset,pointer+positionOffset,pointer+normalOffset,pointer+colorOffset,pointer+uvOffset,pointer+indexOffset);
    if(written<count*2||written>count*8)return null;
    const buffer=core.memory.buffer;geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(new Float32Array(buffer,pointer+positionOffset,n*6),3));
    geometry.setAttribute('color',new THREE.Float32BufferAttribute(new Float32Array(buffer,pointer+colorOffset,n*6),3));
    geometry.setAttribute('uv',new THREE.Float32BufferAttribute(new Float32Array(buffer,pointer+uvOffset,n*4),2));
    geometry.setIndex(new THREE.Uint16BufferAttribute(new Uint16Array(buffer,pointer+indexOffset,written),1));
    geometry.setAttribute('normal',new THREE.BufferAttribute(new Float32Array(new Float32Array(buffer,pointer+normalOffset,n*6)),3));
    geometry.attributes.normal.needsUpdate=true;geometry.userData.fenestrations=4;return geometry;
  }catch{geometry?.dispose();return null;}finally{core.free_f64(pointer,arena);}
}
