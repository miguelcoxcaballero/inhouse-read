import { createShelfPlacementSession } from './shelf-placement-wasm.js';
import { moveShelfDecoration } from './shelf-decoration-layout.js';
import { needRustShelf } from './rust-shelf.js';

export const SHELF_PREVIEW_MIN_OBJECTS = 16;
export const SHELF_PREVIEW_DIRECT_MOVES = 2;

/** Private drag policy. Small shelves and the first two previews retain the
 * direct implementation. Preparation is paid only when an eligible gesture
 * continues. The owner invalidates this controller when its input changes.
 * The policy runs in Rust (rust-ui/src/placement_preview.rs, the shelf module). */
export function createShelfPlacementPreview(objects, options) {
  const preview = new (needRustShelf().ShelfPlacementPreview)(objects, options, createShelfPlacementSession, moveShelfDecoration,
    SHELF_PREVIEW_MIN_OBJECTS, SHELF_PREVIEW_DIRECT_MOVES);
  return { move:(core, key, shelf, x) => preview.move(core, key, shelf, x), dispose:() => preview.dispose() };
}
