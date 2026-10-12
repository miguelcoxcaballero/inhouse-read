import * as THREE from 'three';
import { getRustCore } from './rust-core.js';

let trig;
function angles() {
  if (!trig) {
    trig = new Float64Array(80);
    for (let i = 0; i < 20; i++) {
      const corner = Math.floor(i / 5), k = i % 5;
      const light = (corner * 4 + k) * Math.PI / 8;
      const foot = i / 20 * Math.PI * 2;
      trig.set([Math.cos(light), Math.sin(light)], i * 2);
      trig.set([Math.cos(foot), Math.sin(foot)], 40 + i * 2);
    }
  }
  return trig;
}

/** Same triangles and linear RGBA as the original contact shadow painter. */
export function rustShelfOcclusion(frame, bottoms, ground, footprints, floorLight) {
  const core = getRustCore();
  if (typeof core?.shelf_occlusion !== 'function' || bottoms.length > 1024
      || !Array.isArray(footprints) || footprints.length > 1024) return undefined;
  const feet = footprints.filter(f => f && [f.x, f.z, f.radius].every(Number.isFinite) && f.radius > 0);
  const lit = Array.isArray(floorLight) && floorLight.length === 4 && floorLight.every(Number.isFinite);
  const { w, h, d, side, inner } = frame;
  const header = [w, h, d, side, inner, ground, ...(lit ? floorLight : [0, 0, 0, 0])];
  if (!header.every(Number.isFinite) || !bottoms.every(Number.isFinite)) return undefined;
  const vertices = bottoms.length * 78 + 66 + (lit ? 360 : 0) + feet.length * 300;
  const inputLength = 90 + bottoms.length + feet.length * 3;
  const length = inputLength + Math.ceil(vertices * 7 / 2);
  let pointer = 0;
  try {
    pointer = core.alloc_f64(length);
    if (!pointer) return undefined;
    const input = new Float64Array(core.memory.buffer, pointer, inputLength);
    input.set(header); input.set(bottoms, 10);
    for (let i = 0; i < feet.length; i++) input.set([feet[i].x, feet[i].z, feet[i].radius], 10 + bottoms.length + i * 3);
    input.set(angles(), inputLength - 80);
    const output = pointer + inputLength * 8;
    if (core.shelf_occlusion(pointer, bottoms.length, feet.length, Number(lit), output) !== vertices) return undefined;
    const values = new Float32Array(core.memory.buffer, output, vertices * 7);
    if (!values.every(Number.isFinite)) return undefined;
    const geometry = new THREE.BufferGeometry();
    // BufferAttribute constructors copy: no retained views into freed WASM.
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(values.subarray(0, vertices * 3), 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(values.subarray(vertices * 3), 4));
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    return geometry;
  } catch { return undefined; }
  finally { if (pointer) core.free_f64(pointer, length); }
}
