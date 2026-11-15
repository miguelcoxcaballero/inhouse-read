// Frozen from src/js/bookshelf-scene.js 1.8.1 (updateTrash and its `corners` helper): one frame of an
// entry's flight into the bin as the host asked three and four natives for it, and the bin's box on
// screen as the host packed it, before both became one native call each (rust-ui/src/scene_flight.rs,
// scene_bin.rs `binBox`). Do not edit.
import * as THREE from 'three';

const IDENTITY = new THREE.Matrix4();
export function referenceCorners(rust) {
  const cornerBox = new Float64Array(6), cornerRect = new Float64Array(7);
  return (box, transform, out = {}) => {
    if (box.isBox3) {
      const { min, max } = box;
      cornerBox[0] = min.x; cornerBox[1] = min.y; cornerBox[2] = min.z; cornerBox[3] = max.x; cornerBox[4] = max.y; cornerBox[5] = max.z;
      box = cornerBox;
    }
    rust.scene_corners(box, transform.elements, cornerRect);
    out.left = cornerRect[0]; out.right = cornerRect[1]; out.top = cornerRect[2]; out.bottom = cornerRect[3];
    out.width = cornerRect[4]; out.height = cornerRect[5]; out.closest = cornerRect[6];
    return out;
  };
}

// `slotBox` is the six numbers of the entry's slot box (the host copied them out of the entry arena).
export function referenceFlight(rust, corners, sampleTrashDrop, trash, drop, dropEntry, slotBox, t, sceneWidth, overflow) {
  const worldScale = trash.getWorldScale(new THREE.Vector3()).x;
  const endScale = rust.scene_trash_end_scale(worldScale, trash.userData.radius, dropEntry.width, dropEntry.height);
  const motion = sampleTrashDrop(drop.start, trash.userData.getMouth(), t,
    { height:dropEntry.height, scale:drop.startScale, endScale });
  dropEntry.model.position.copy(motion.position);
  dropEntry.model.scale.setScalar(motion.scale);
  trash.getWorldQuaternion(drop.endQuaternion).multiply(drop.bookQuaternion);
  dropEntry.model.quaternion.copy(drop.startQuaternion).slerp(drop.endQuaternion, motion.turn);
  dropEntry.model.updateMatrixWorld(true);
  const flightBounds = corners(slotBox, dropEntry.model.matrixWorld);
  rust.scene_trash_overflow(flightBounds.right, sceneWidth, t, overflow);
  // The pointer may leave a broad book partly outside the canvas at
  // release. Bend its first few frames inward instead of snapping its
  // starting pose or clipping the newly exposed cover for the flight.
  if (overflow[0]) {
    dropEntry.model.position.x -= overflow[1];
    dropEntry.model.updateMatrixWorld(true);
  }
}

// The bin's box on screen, packed for `trashPlaced`.
const trashRect0 = {};
export function referenceBinRect(corners, trashBox, trash, trashPacked) {
  const trashRect = corners(trashBox.setFromObject(trash), IDENTITY, trashRect0);
  trashPacked[0] = trashRect.left; trashPacked[1] = trashRect.right; trashPacked[2] = trashRect.top; trashPacked[3] = trashRect.bottom;
  trashPacked[4] = trashRect.width; trashPacked[5] = trashRect.height;
  return trashPacked;
}
