import * as THREE from 'three';
import { loadedRustCore } from './rust-core.js';
import { needRustShelf } from './rust-shelf.js';

/** Contact shadows of a cabinet: positions and linear RGBA, drawn by the numeric core from the
 * raw cabinet measures, shelf rows and floor light. The request (feet, floor light, arena, the
 * host's cos/sin table) is made by the Rust shelf module (rust-ui/src/shelf_occlusion_host.rs),
 * which hands `geometryOf` views of the core's output before releasing it. */
export function rustShelfOcclusion(width, height, depth, floorY, bottoms, footprints, floorLight) {
  const core = loadedRustCore();
  return needRustShelf().shelf_occlusion_request(core, width, height, depth, floorY, bottoms, footprints, floorLight, geometryOf);
}

// BufferAttribute constructors copy: no retained views into freed WASM.
function geometryOf(position, color) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(color, 4));
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
}
