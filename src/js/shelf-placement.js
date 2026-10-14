import { getRustCore } from './rust-core.js';
import { placeObjects } from './shelf-placement-wasm.js';

/**
 * Positions on a shelf are saved as centres in its usable width (0..1),
 * rather than pixels. A phone resize therefore keeps deliberately empty
 * space, while physical object widths still prevent overlapping spines.
 *
 * Inputs are flat objects { key, kind, width, shelf?, x?, ... }. Books use
 * `book:<id>` and plants use `plant:<seed>`. No DOM or storage is involved.
 * The collision, gap and overflow rules run in the Rust core
 * (rust-core/src/shelf_placement.rs); the first shelf render awaits that core.
 */
const core = () => {
  const loaded = getRustCore();
  if (!loaded) throw new Error('Shelf placement needs the Rust core');
  return loaded;
};

/**
 * Lay out saved objects, keep empty gaps, and insert objects with no x into
 * the first available gap from their requested row onward.
 * Output items add { left, center } in pixels and normalized { shelf, x }.
 */
export function layoutShelvedObjects(objects, options = {}) {
  return placeObjects(core(), objects, options);
}

/**
 * Move one book OR plant. The returned `placements` is a complete, cleaned
 * snapshot for all present objects, including neighbours displaced by it.
 * Persist that snapshot, not just the dragged object's target. It can be
 * used as cfg.placements on later calls or after a viewport resize.
 */
export function moveShelfObject(objects, key, target, options = {}) {
  return placeObjects(core(), objects, options, { move:true, movedKey:key, target });
}
