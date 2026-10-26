import * as THREE from 'three';
import { needRustShelf } from './rust-shelf.js';

/** The book travels above the open rim, then falls into the actual hollow body.
 * All positions use the same world axes as the cabinet and its shared camera. The flight's
 * arithmetic runs in Rust (rust-ui/src/shelf_trash.rs); only the Vector3 is built here. */
export function sampleTrashDrop(start, mouth, progress, { height = 200, scale = 1, endScale = .19 } = {}) {
  const [x, y, z, size, turn, fall] = needRustShelf().sample_trash_drop(start.x, start.y, start.z, mouth.x, mouth.y, mouth.z, progress, height, scale, endScale);
  return { position:start.clone().set(x, y, z), scale:size, turn, fall };
}

// The closures the scene holds. `setState` and `getMouth` run every frame of a drop, so they stay
// here over the bin's lid, root and mouth (one Rust read per frame was ~25x slower); the lid's
// arithmetic is Rust's.
function closures(state) {
  const shelf = needRustShelf(), { basket, lid, mouth } = state;
  return {
    setState({ openness = 0, bounce = 0 } = {}) {
      const [open, swing] = shelf.trash_lid_open(openness);
      lid.rotation.x = swing;
      lid.rotation.z = shelf.trash_lid_wobble(bounce);
      basket.userData.openness = open;
    },
    getMouth:() => new THREE.Vector3(0, mouth, 0).applyMatrix4(basket.matrixWorld),
    dispose:() => shelf.trash_dispose(state)
  };
}

/** A powder-coated steel pedal bin: rolled rim, removable inner bucket, moulded base with a
 * brushed-steel pedal and a domed stainless lid on a rear hinge; opening is the lid's rotation
 * about its back axle. Built, three.js objects included, by rust-ui/src/decor_build.rs. */
export const createShelfTrash = options => needRustShelf().trash_create(THREE, options, closures);
