import * as THREE from 'three';
import { needRustShelf } from './rust-shelf.js';

// The keys of the reusable case, the single view that waits for the reader's return and the
// matrices it lands on are computed in Rust (rust-ui/src/bookshelf_return.rs, the shelf module).

/** Keep the case's visual inputs strict. Storage/cloud metadata and progress
 * cannot alter its pixels; final progress is applied to the ribbon separately. */
export const bookReturnSignature = (book, style, geometry, coverUrl) => needRustShelf().book_return_signature(book, style, geometry, coverUrl);

/** Explicit reuse key: discard only arithmetic noise in the comparison, never
 * in the actual geometry. Viewport, cover ratio and structural style stay strict. */
export const bookReturnCompatibility = (book, style, geometry) => needRustShelf().book_return_compatibility(book, style, geometry);

/** One already rendered book may wait behind the reader. Ownership transfers
 * once to the close animation; a mismatch, replacement or destroy releases it.
 * The decisions are the Rust object's; the promise reactions of a pending
 * upgrade stay here, so they are collected with the cache. */
export function createBookReturnCache() {
  const cache = new (needRustShelf().BookReturnCache)();
  return {
    retain:(signature, view, compatibility) => cache.retain(signature, view, compatibility),
    take:signature => cache.take(signature),
    takeCompatible(request) {
      let step;
      try { step = cache.startCompatible(request); } catch (error) { return Promise.reject(error); }
      const [answer, token] = step;
      return token ? Promise.resolve(answer).then(ready => cache.finish(token, ready), () => cache.fail(token)) : Promise.resolve(answer);
    },
    clear:() => cache.clear()
  };
}

/** A parked book's transform in the cabinet's coordinate system. */
export const shelfBookSlot = (entry, cabinetWidth) => new THREE.Matrix4().fromArray(needRustShelf().shelf_book_slot(entry, cabinetWidth));

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
  const [angle, pitch, roll, scale, centerX, centerY, depth] = needRustShelf().project_shelf_book_pose(furnitureMatrix.elements, localMatrix.elements, stageRect.left, stageRect.top);
  return { width:dimensions.width, height:dimensions.height, thickness:dimensions.thickness, angle, pitch, roll, scale, centerX, centerY, depth };
}
