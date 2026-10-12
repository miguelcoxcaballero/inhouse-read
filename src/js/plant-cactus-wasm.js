import * as THREE from 'three';

const align8 = bytes => Math.ceil(bytes / 8) * 8;
const sampleOffset = 99 * 8;
const positionOffset = sampleOffset + 627 * 8;
const normalOffset = positionOffset + align8(1881 * 4);
const colorOffset = normalOffset + align8(1881 * 4);
const uvOffset = colorOffset + align8(1881 * 4);
const indexOffset = uvOffset + align8(1254 * 4);
const arenaLength = (indexOffset + 3456 * 2) / 8;
let columns;

/** Own output attributes; no memory lease escapes the call. The caller keeps
 * its original PRNG samples available for an unavailable/rejected core. */
export function rustPlantCactusGeometry(core, { length, radius, bend, samples }) {
  if (typeof core?.plant_cactus_mesh !== 'function'
      || ![length,radius,bend].every(Number.isFinite) || length<=0 || radius<=0
      || length>1e6 || radius>1e6 || Math.abs(bend)>1e6
      || !(samples instanceof Float64Array) || samples.length!==627) return null;
  let pointer;
  try { pointer=core.alloc_f64(arenaLength); } catch { return null; }
  if (!pointer) return null;
  let geometry=null;
  try {
    if (!columns) {
      columns=new Float64Array(99);
      for (let col=0;col<=32;col++) {
        const angle=col/32*Math.PI*2;
        columns[col*3]=Math.cos(angle); columns[col*3+1]=Math.sin(angle);
        columns[col*3+2]=Math.cos(angle*8);
      }
    }
    new Float64Array(core.memory.buffer,pointer,99).set(columns);
    new Float64Array(core.memory.buffer,pointer+sampleOffset,627).set(samples);
    if (core.plant_cactus_mesh(length,radius,bend,pointer,pointer+sampleOffset,
        pointer+positionOffset,pointer+normalOffset,pointer+colorOffset,pointer+uvOffset,pointer+indexOffset)!==3456) return null;
    const buffer=core.memory.buffer;
    geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(new Float32Array(buffer,pointer+positionOffset,1881),3));
    geometry.setAttribute('color',new THREE.Float32BufferAttribute(new Float32Array(buffer,pointer+colorOffset,1881),3));
    geometry.setAttribute('uv',new THREE.Float32BufferAttribute(new Float32Array(buffer,pointer+uvOffset,1254),2));
    geometry.setIndex(new THREE.Uint16BufferAttribute(new Uint16Array(buffer,pointer+indexOffset,3456),1));
    // computeVertexNormals originally creates a plain BufferAttribute here.
    geometry.setAttribute('normal',new THREE.BufferAttribute(new Float32Array(new Float32Array(buffer,pointer+normalOffset,1881)),3));
    geometry.attributes.normal.needsUpdate=true;
    return geometry;
  } catch { geometry?.dispose(); return null; }
  finally { core.free_f64(pointer,arenaLength); }
}
