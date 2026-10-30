import * as THREE from 'three';
import { loadedRustCore } from './rust-core.js';
import { needRustShelf } from './rust-shelf.js';

// cos/sin of the light and foot-ring directions, from the host's Math (rust-ui/src/occlusion_table.rs).
let trig;
const angles = () => trig ??= needRustShelf().occlusion_angles();

/** Contact shadows of a cabinet: positions and linear RGBA, drawn by the numeric core from the
 * raw cabinet measures, shelf rows and floor light. */
export function rustShelfOcclusion(width, height, depth, floorY, bottoms, footprints, floorLight) {
  const core = loadedRustCore();
  const feet = footprints.filter(f => f && [f.x, f.z, f.radius].every(Number.isFinite) && f.radius > 0);
  const lit = Array.isArray(floorLight) && floorLight.length === 4 && floorLight.every(Number.isFinite);
  const inputLength = 90 + bottoms.length + feet.length * 3;
  const most = bottoms.length * 78 + 66 + (lit ? 360 : 0) + feet.length * 300;
  const length = inputLength + Math.ceil(most * 7 / 2);
  const pointer = core.alloc_f64(length);
  if (!pointer) throw new Error('El módulo numérico no pudo reservar memoria.');
  try {
    const input = new Float64Array(core.memory.buffer, pointer, inputLength);
    input[0] = width; input[1] = height; input[2] = depth; input[3] = floorY;
    if (lit) input.set(floorLight, 6);
    input.set(bottoms, 10);
    for (let i = 0; i < feet.length; i++) input.set([feet[i].x, feet[i].z, feet[i].radius], 10 + bottoms.length + i * 3);
    input.set(angles(), inputLength - 80);
    const output = pointer + inputLength * 8;
    const vertices = core.shelf_occlusion(pointer, bottoms.length, feet.length, Number(lit), output);
    if (!vertices) throw new Error('El módulo numérico no pudo calcular las sombras.');
    const values = new Float32Array(core.memory.buffer, output, vertices * 7);
    const geometry = new THREE.BufferGeometry();
    // BufferAttribute constructors copy: no retained views into freed WASM.
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(values.subarray(0, vertices * 3), 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(values.subarray(vertices * 3), 4));
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    return geometry;
  } finally { core.free_f64(pointer, length); }
}
