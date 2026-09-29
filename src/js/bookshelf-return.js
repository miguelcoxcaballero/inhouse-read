import * as THREE from 'three';

/** A parked book's transform in the cabinet's coordinate system. */
export function shelfBookSlot(entry, cabinetWidth) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(entry.x - cabinetWidth / 2, -entry.y, -entry.width / 2),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2, 0, 'XYZ')),
    new THREE.Vector3(1, 1, 1)
  );
}

/** Move the aligned book entirely outside the cabinet before sliding it in. */
export function shelfBookInsertion(slot, bookWidth, progress = 0) {
  const remaining = 1 - Math.max(0, Math.min(1, progress));
  const matrix = slot.clone();
  matrix.elements[13] += 6 * remaining;
  matrix.elements[14] += (bookWidth + 24) * remaining;
  return matrix;
}

/** Preserve the full composed rotation when switching between both canvases. */
export function projectShelfBookPose(furnitureMatrix, localMatrix, dimensions, stageRect) {
  const world = new THREE.Matrix4().multiplyMatrices(furnitureMatrix, localMatrix);
  const position = new THREE.Vector3(), quaternion = new THREE.Quaternion(), scale = new THREE.Vector3();
  world.decompose(position, quaternion, scale);
  const rotation = new THREE.Euler().setFromQuaternion(quaternion, 'XYZ');
  return {
    width:dimensions.width, height:dimensions.height, thickness:dimensions.thickness,
    angle:THREE.MathUtils.radToDeg(rotation.y), pitch:THREE.MathUtils.radToDeg(rotation.x),
    roll:THREE.MathUtils.radToDeg(rotation.z), scale:scale.x,
    centerX:stageRect.left + position.x, centerY:stageRect.top - position.y, depth:position.z
  };
}
