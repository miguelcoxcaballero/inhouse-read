import * as THREE from 'three';

/** Finish an external LatheGeometry without changing the original attributes
 * until the kernel succeeds. Returns the soil radius, or null for fallback. */
export function rustPlantPotSurface(core,geometry,potId,profile,segments,radius,height,soilFraction) {
  const n=profile?.length,count=(segments+1)*n;
  if(typeof core?.plant_pot_surface!=='function' || !Number.isInteger(n) || n<3 || n>64
      || !Number.isInteger(segments) || segments<3 || segments>128
      || ![radius,height,soilFraction].every(Number.isFinite) || radius<=0 || radius>1e6
      || soilFraction<0 || soilFraction>=1) return null;
  const {position,normal,uv}=geometry.attributes,index=geometry.index;
  if(position?.count!==count || normal?.count!==count || uv?.count!==count
      || !(index?.array instanceof Uint16Array) || index.count!==segments*(n-1)*6) return null;
  const kind=potId==='gradvis'?2:potId==='muskot'?1:0;
  let length=0;
  const reserve=bytes=>{const offset=length;length+=Math.ceil(bytes/8)*8;return offset;};
  const profileOffset=reserve(n*4*8),ribOffset=reserve(count*2*8),positionOffset=reserve(count*3*4);
  const normalOffset=reserve(count*3*4),uvOffset=reserve(count*2*4),colorOffset=reserve(count*3*4);
  const indexOffset=reserve(index.count*2),resultOffset=reserve(8),arena=length/8;
  let pointer;
  try{pointer=core.alloc_f64(arena);}catch{return null;}
  if(!pointer)return null;
  try{
    let buffer=core.memory.buffer,arc=0,top=0;
    const rows=new Float64Array(buffer,pointer+profileOffset,n*4);
    for(let j=0;j<n;j++){
      const [r,y]=profile[j];
      if(j)arc+=Math.hypot((r-profile[j-1][0])*radius,(y-profile[j-1][1])*height);
      rows.set([r,y,arc,kind===2?Math.sin(Math.min(1,y*7)*Math.PI/2)*Math.min(1,Math.max(0,(.97-y)*14)):0],j*4);
      if(y>profile[top][1])top=j;
    }
    const ribs=new Float64Array(buffer,pointer+ribOffset,count*2);ribs.fill(0);
    if(kind===2)for(let i=0;i<=segments;i++)for(let j=0;j<top;j++){
      const at=i*n+j,x=position.getX(at),z=position.getZ(at);
      ribs[at*2]=Math.hypot(x,z);ribs[at*2+1]=-Math.cos(Math.atan2(x,z)*32);
    }
    new Float32Array(buffer,pointer+positionOffset,count*3).set(position.array);
    new Float32Array(buffer,pointer+normalOffset,count*3).set(normal.array);
    new Float32Array(buffer,pointer+uvOffset,count*2).set(uv.array);
    new Uint16Array(buffer,pointer+indexOffset,index.count).set(index.array);
    if(core.plant_pot_surface(kind,n,segments,radius,soilFraction,pointer+profileOffset,pointer+ribOffset,
      pointer+positionOffset,pointer+normalOffset,pointer+uvOffset,pointer+colorOffset,pointer+indexOffset,pointer+resultOffset)!==1)return null;
    buffer=core.memory.buffer;
    const soilRadius=new Float64Array(buffer,pointer+resultOffset,1)[0];
    const color=new THREE.BufferAttribute(new Float32Array(new Float32Array(buffer,pointer+colorOffset,count*3)),3);
    position.array.set(new Float32Array(buffer,pointer+positionOffset,count*3));
    normal.array.set(new Float32Array(buffer,pointer+normalOffset,count*3));
    uv.array.set(new Float32Array(buffer,pointer+uvOffset,count*2));
    geometry.setAttribute('color',color);if(kind===2)normal.needsUpdate=true;
    return soilRadius;
  }catch{return null;}
  finally{core.free_f64(pointer,arena);}
}
