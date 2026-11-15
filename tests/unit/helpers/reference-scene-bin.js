// Frozen from src/js/bookshelf-scene.js 1.7.339: the bin as the host handed it to the view in every
// frame, before the view kept it from the moment it is placed (rust-ui/src/scene_bin.rs). Do not edit.
import * as THREE from 'three';

// positionTrash's native call (rust-ui/src/scene_room.rs as of 1.7.339, itself frozen in
// reference-scene-room.js): the bin stands on the floor clear of the wall, upright, unscaled, shown.
export function referencePositionTrash(sceneView, trash, trashBounds, roomWall, floorY, TRASH_GAP) {
  const standOut = new Float64Array(3);
  sceneView.trashStand(trash.userData.radius, trashBounds.min.z, trashBounds.min.y, roomWall.position.z, floorY, TRASH_GAP, standOut);
  trash.position.set(standOut[0], standOut[1], standOut[2]);
  trash.rotation.set(0, 0, 0); trash.scale.setScalar(1); trash.visible = true;
}

// packBin: the bin's footprint and place, for the view's fit and the shadow's bounds.
export function referencePackBin(binBox, trashBounds, trash) {
  const { min, max } = trashBounds, { position } = trash;
  binBox[0] = min.x; binBox[1] = min.y; binBox[2] = min.z; binBox[3] = max.x; binBox[4] = max.y; binBox[5] = max.z;
  binBox[6] = position.x; binBox[7] = position.y; binBox[8] = position.z;
}

// updateTransform's room: turned, scaled and placed as the view's fit says, its root matrix taken.
export function referenceRoom(furniture, viewFrame) {
  furniture.rotation.set(viewFrame[1], viewFrame[0], 0); furniture.scale.setScalar(viewFrame[2]);
  furniture.position.set(viewFrame[3], viewFrame[4], 0);
  furniture.updateWorldMatrix(false, false);
}

// The tail of updateTrash: the seventeen numbers of the bin's diagnostics.
const footPoint = new THREE.Vector3(), floorPoint = new THREE.Vector3();
export function referenceBinNumbers(furniture, trash, trashBounds, floorY, trashNumbers) {
  const footY = trash.position.y + trashBounds.min.y * trash.scale.y;
  const footWorld = furniture.localToWorld(footPoint.set(trash.position.x, footY, trash.position.z));
  const floorContact = furniture.localToWorld(floorPoint.set(trash.position.x, floorY, trash.position.z));
  const { position, rotation } = trash, n = trashNumbers;
  n[0] = position.x; n[1] = position.y; n[2] = position.z; n[3] = trash.scale.x; n[4] = rotation.x; n[5] = rotation.y; n[6] = rotation.z;
  n[7] = footY; n[8] = floorY; n[9] = footWorld.x; n[10] = footWorld.y; n[11] = footWorld.z;
  n[12] = floorContact.x; n[13] = floorContact.y; n[14] = floorContact.z; n[15] = trash.userData.radius; n[16] = trash.userData.height;
  return n;
}
