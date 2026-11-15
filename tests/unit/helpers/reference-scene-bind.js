// Frozen from src/js/bookshelf-scene.js 1.7.339: what the host did in every frame and the scene now
// does once per layout or keeps in Rust (the room's inverse turn, the solver's keys, the buttons'
// style history, the bin's box). Do not edit.

// updateTransform, then the head of updateEntries: the room turned as the view's fit says, and
// the inverse of its turn handed to the frame's entries.
export function referenceInverseTurn(furniture, viewFrame, inverseRotation, inverseTurn) {
  furniture.rotation.set(viewFrame[1], viewFrame[0], 0);
  inverseRotation.copy(furniture.quaternion).invert();
  inverseTurn[0] = inverseRotation.x; inverseTurn[1] = inverseRotation.y; inverseTurn[2] = inverseRotation.z; inverseTurn[3] = inverseRotation.w;
  return inverseTurn;
}

// The frame's registrations (updateEntries, with gravity-frame.js and scene-projection-frame.js,
// now tests/unit/helpers): the style history before the entries are read, the solver's keys when
// the rigid bodies step.
export function referenceFrameRegistrations(projectionFrame, gravityFrame, bookEntries, usePhysics) {
  projectionFrame.prepare(bookEntries);
  if (usePhysics) gravityFrame.prepare(bookEntries);
}

// packBin, twice in every frame (updateTransform and draw).
export function referencePackBin(binBox, trashBounds, trash) {
  const { min, max } = trashBounds, { position } = trash;
  binBox[0] = min.x; binBox[1] = min.y; binBox[2] = min.z; binBox[3] = max.x; binBox[4] = max.y; binBox[5] = max.z;
  binBox[6] = position.x; binBox[7] = position.y; binBox[8] = position.z;
}
