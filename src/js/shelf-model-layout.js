import { SHELF_SPECS, normalizeShelfType } from './shelf-types.js';
import { BOOK_REFERENCE_MM } from './plant-dimensions.js';
import { getRustCore } from './rust-core.js';
import { rustShelfModelLayout } from './shelf-model-layout-wasm.js';

/** Keep every shelf (BAGGEBO or the wooden one, both 600 x 250 x 1160 mm) at
 * its real proportions. Overflow uses another unit, rather than adding
 * shelves or stretching the original piece of furniture. The arithmetic lives in the
 * numeric core (rust-core/src/shelf_model.rs); the shelf render awaits that core before
 * it measures anything, so an unavailable core is an error to show, never a reason to
 * lay the cabinet out another way. */
export function shelfModelLayout(layout, type = layout.shelfType) {
  const shelfType = normalizeShelfType(type), BAGGEBO_SPEC = SHELF_SPECS[shelfType], core = getRustCore();
  if (!core) throw new Error('El módulo numérico no está cargado. Recarga la página.');
  const native = rustShelfModelLayout(core, layout, BAGGEBO_SPEC, shelfType, BOOK_REFERENCE_MM);
  if (!native) throw new Error('El módulo numérico rechazó la medida de la estantería. Recarga la página.');
  return native;
}

/** Kept under its first name: the BAGGEBO is the reference piece. */
export const baggeboLayout = layout => shelfModelLayout(layout, 'baggebo');

/** Internal handoff from measure(); the same total layout, kept under its caller's name. */
export const measuredShelfModelLayout = (layout,type) => shelfModelLayout(layout,type);
