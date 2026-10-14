import { SHELF_SPECS, normalizeShelfType } from './shelf-types.js';
import { BOOK_REFERENCE_MM } from './plant-dimensions.js';
import { getRustCore } from './rust-core.js';
import { rustShelfModelLayout } from './shelf-model-layout-wasm.js';

/** Keep every shelf (BAGGEBO or the wooden one, both 600 x 250 x 1160 mm) at
 * its real proportions. Overflow uses another unit, rather than adding
 * shelves or stretching the original piece of furniture. */
export function shelfModelLayout(layout, type = layout.shelfType, measured = false) {
  const shelfType = normalizeShelfType(type), BAGGEBO_SPEC = SHELF_SPECS[shelfType];
  const native = rustShelfModelLayout(getRustCore(), layout, BAGGEBO_SPEC, shelfType, BOOK_REFERENCE_MM, measured);
  if (!native) throw new Error('Shelf model layout was rejected by the Rust core');
  return native;
}

/** Kept under its first name: the BAGGEBO is the reference piece. */
export const baggeboLayout = layout => shelfModelLayout(layout, 'baggebo');

/** Internal handoff from measure(): every geometry value has just been
 * constructed by our shelf renderer. External callers keep the checked path. */
export const measuredShelfModelLayout = (layout,type) => shelfModelLayout(layout,type,true);
