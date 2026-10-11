import * as THREE from 'three';

const align8 = bytes => Math.ceil(bytes / 8) * 8;
const variants = new Map([['upright',1],['succulent',2],['monstera',3],['palm',4],['fern',5],['zz',6],['leafy',7],['ivy',8]]);

/** Complete leaf geometry, with the original attribute classes and versions.
 * Tint and hue have already consumed exactly the original two PRNG values.
 * The bounded arena is released before return; no buffer aliases WASM memory.
 * A failed/cold core returns null and the caller continues its original loop.
 */
export function rustPlantLeafGeometry(core, { length, width, variant, curve, twist, tint, hue, detailed = false }) {
  const code = variants.get(variant);
  if (!code || typeof detailed !== 'boolean' || ![length,width,curve,twist,tint,hue].every(Number.isFinite)
      || length <= 0 || width <= 0 || length > 1e6 || width > 1e6 || Math.abs(curve) > 1e3 || Math.abs(twist) > 1e3
      || tint < 0 || tint >= .08 || hue < -.05 || hue > .05
      || typeof core?.plant_leaf_mesh !== 'function' || !core.memory
      || typeof core.alloc_f64 !== 'function' || typeof core.free_f64 !== 'function') return null;
  const rows = variant === 'palm' ? 4 : variant === 'fern' ? 3 : variant === 'zz' ? 6 : variant === 'succulent' && detailed ? 10
    : variant === 'ivy' ? 8 : variant === 'upright' ? 16 : variant === 'monstera' ? 14 : 12;
  const columns = variant === 'palm' || variant === 'fern' ? 2 : variant === 'monstera' ? 10
    : variant === 'leafy' || variant === 'upright' || (variant === 'succulent' && detailed) ? 6 : 4;
  const thick = variant === 'succulent' || (detailed && variant !== 'palm' && variant !== 'fern');
  const vertices = (rows + 1) * (columns + 1) * (thick ? 2 : 1);
  const maxIndices = rows * columns * (thick ? 12 : 6) + (thick ? (rows + columns) * 12 : 0);
  const columnOffset = (rows + 1) * 9 * 8;
  const positionOffset = columnOffset + (columns + 1) * 3 * 8;
  const normalOffset = positionOffset + align8(vertices * 3 * 4);
  const colorOffset = normalOffset + align8(vertices * 3 * 4);
  const uvOffset = colorOffset + align8(vertices * 3 * 4);
  const indexOffset = uvOffset + align8(vertices * 2 * 4);
  const arenaLength = Math.ceil((indexOffset + maxIndices * 2) / 8);
  let pointer;
  try { pointer = core.alloc_f64(arenaLength); } catch { return null; }
  if (!pointer) return null;
  let geometry = null;
  try {
    const coefficients = new Float64Array(core.memory.buffer, pointer, positionOffset / 8);
    for (let row = 0; row <= rows; row++) {
      const f = row / rows, at = row * 9;
      coefficients[at] = variant === 'upright' ? Math.pow(Math.max(0, 1 - f * f), .68) * (.72 + .28 * Math.sin(f * Math.PI))
        : variant === 'succulent' ? (f < .74 ? .42 + .58 * Math.sin(f / .74 * Math.PI / 2) : Math.pow(Math.cos((f - .74) / .26 * Math.PI / 2), .55))
        : Math.pow(Math.max(0,Math.sin(Math.PI * Math.pow(f, variant === 'leafy' || variant === 'ivy' ? .56 : .75))), variant === 'zz' ? .45 : .65);
      coefficients[at + 1] = variant === 'monstera' ? 1 - .54 * Math.pow(Math.sin(f * Math.PI * 5), 8)
        : variant === 'ivy' ? .53 + .47 * Math.pow(Math.cos(f * Math.PI * 3.3 - .2),2)
        : variant === 'fern' ? .92 + .08 * Math.cos(f * Math.PI * 14) : 1;
      coefficients[at + 2] = Math.sin(f * 7 + twist * 4);
      coefficients[at + 3] = Math.sin(f * Math.PI * .85);
      coefficients[at + 4] = Math.sin(f * 19 + twist * 9);
      coefficients[at + 5] = Math.sin(f * Math.PI);
      coefficients[at + 6] = Math.cos(twist * f);
      coefficients[at + 7] = Math.sin(twist * f);
      coefficients[at + 8] = variant === 'succulent' ? Math.pow(Math.sin(f * Math.PI), .65) : 0;
    }
    for (let col = 0; col <= columns; col++) {
      const u = col / columns * 2 - 1, at = columnOffset / 8 + col * 3;
      coefficients[at] = Math.pow(Math.abs(u), variant === 'succulent' ? 2 : 1.5);
      coefficients[at + 1] = Math.pow(Math.abs(u), 3);
      coefficients[at + 2] = Math.pow(Math.abs(u), 2);
    }
    const count = core.plant_leaf_mesh(pointer, pointer + columnOffset, length, width, curve, tint, hue,
      rows, columns, code, Number(detailed), pointer + positionOffset, pointer + normalOffset,
      pointer + colorOffset, pointer + uvOffset, pointer + indexOffset);
    if (!Number.isInteger(count) || count < 0 || count > maxIndices || count % 3) return null;
    // Re-read memory after the call: an instrumented core or future kernel may
    // grow memory. Float32BufferAttribute makes the one owned output copy.
    const buffer = core.memory.buffer;
    geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(buffer, pointer + positionOffset, vertices * 3), 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(buffer, pointer + normalOffset, vertices * 3), 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(buffer, pointer + colorOffset, vertices * 3), 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(buffer, pointer + uvOffset, vertices * 2), 2));
    geometry.setIndex(new THREE.Uint16BufferAttribute(new Uint16Array(buffer, pointer + indexOffset, count), 1));
    geometry.attributes.normal.needsUpdate = true;
    return geometry;
  } catch {
    geometry?.dispose();
    return null;
  } finally { core.free_f64(pointer, arenaLength); }
}
