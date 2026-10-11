import { createShelfPlacementSession } from './shelf-placement-wasm.js';
import { moveShelfDecoration } from './shelf-decoration-layout.js';

export const SHELF_PREVIEW_MIN_OBJECTS = 16;
export const SHELF_PREVIEW_DIRECT_MOVES = 2;

/** Private drag policy. Small shelves and the first two previews retain the
 * direct implementation. Preparation is paid only when an eligible gesture
 * continues. The owner invalidates this controller when its input changes. */
export function createShelfPlacementPreview(objects, options) {
  let moves = 0, prepared = false, session = null, disposed = false;
  return {
    move(core, key, shelf, x) {
      if (disposed) return undefined;
      moves += 1;
      if (Array.isArray(objects) && objects.length >= SHELF_PREVIEW_MIN_OBJECTS &&
          moves > SHELF_PREVIEW_DIRECT_MOVES && core) {
        if (!prepared) { prepared = true; session = createShelfPlacementSession(objects, options); }
        const result = session?.move(core, key, shelf, x);
        if (disposed) return undefined;
        if (result !== undefined) return result;
      }
      const result = moveShelfDecoration(objects, key, { shelf, x }, options);
      return disposed ? undefined : result;
    },
    dispose() {
      disposed = true;
      session?.dispose(); session = null;
      objects = null; options = null;
    },
  };
}
