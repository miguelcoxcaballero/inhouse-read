import { core, tables, scratch, scratchPointer } from './decor-catalogue.js';

// Canonical IKEA sizes (cm, checked 2026-10-02) and everything derived from
// them live in the Rust core: the millimetre tables, each species' standard
// class, the dimensions of every plant in every pot and the catalogue labels.
// Only a plant or pot the tables name is looked up; an unknown pot stands for
// the MUSKOT, as before.
export const IKEA_SIZES_CM = Object.freeze(tables.ikea);
export const POT_DIAMETER_MM = tables.constants.potDiameterMm; // nursery class only
export const POT_SIZES = Object.freeze(tables.potSizes);
export const PLANT_SIZES = Object.freeze(tables.plantSizes);
export const PLANT_REFERENCE_POTS = Object.freeze(tables.referencePots);
export const PLANT_DEFAULT_POTS = Object.freeze(tables.defaultPots);
export const POT_SOIL_FRACTION = tables.constants.potSoilFraction;
/** Free height (mm) between a shelf board and the underside of the one above. */
export const SHELF_CLEARANCE_MM = Object.freeze(tables.shelfClearance);
/** Plants above this interior limit are fitted uniformly inside their bay. */
export const PLANT_MAX_HEIGHT_MM = tables.constants.plantMaxHeightMm;

const has = (table, key) => typeof key === 'string' && Object.hasOwn(table, key);

/** Largest IKEA size class of a species that fits under PLANT_MAX_HEIGHT_MM
 * (the smallest class, flagged `fits:false`, if none does). */
export function standardPlantClass(plantId) {
  return has(tables.standardClasses, plantId) ? { ...tables.standardClasses[plantId] } : null;
}

/** Real dimensions (mm) of one plant standing in one pot. `width` is its slot
 * on the board: the canopy, or the pot with its saucer if that is wider. */
export function plantDimensions(plantId, potId) {
  return has(tables.dimensions, plantId)
    ? { ...tables.dimensions[plantId][has(POT_SIZES, potId) ? potId : ''] } : null;
}

/** Outer pot diameter × height, plant height and confidence in the catalogue. */
export function plantSizeLabel(plantId, potId) {
  return has(tables.sizeLabels, plantId) ? tables.sizeLabels[plantId][has(POT_SIZES, potId) ? potId : ''] : '';
}

/** Book height at its tallest (heightRatio 1): 24 cm; spineStyleFor varies it
 * down to 80 % (19.2 cm), a typical 21-22 cm paperback or hardback. */
export const BOOK_REFERENCE_MM = tables.constants.bookReferenceMm;
/** Spine thickness of a real book: a slim paperback to a thick hardback. */
export const BOOK_THICKNESS_MM = Object.freeze(tables.constants.bookThicknessMm);
/** Depth of a standing book: its cover width, 13-16 cm for a hardback. */
export const BOOK_DEPTH_MM = Object.freeze(tables.constants.bookDepthMm);

/**
 * Scene pixels per millimetre. Both shelves are 600 mm wide units that fill
 * the shelf width, the scale lamps, books and plants use. Without a measured
 * width (a DOM-only fallback) a 600 mm unit is assumed 390 px wide.
 */
export function shelfScale({ shelfWidth } = {}) {
  return core.shelf_scale(Number(shelfWidth));
}

/** `spineStyleFor` options that draw real thicknesses, in pixels for a shelf
 * `shelfWidth` px wide (a 600 mm unit): 0.14 mm per leaf plus 4 mm of binding.
 * Long volumes can exceed 45 mm; their cover aspect ratio stays independent. */
export function bookSpineOptions(shelfWidth) {
  const out = scratch();
  core.book_spine_options(shelfScale({ shelfWidth }), scratchPointer);
  return { minWidth:out[0], maxWidth:out[1], bindingThickness:out[2], pageThickness:out[3], jitter:0 };
}

/** A thin real spine is hard to tap, so a book never gets a layout cell
 * narrower than this many pixels, even if the drawn spine is. */
export function minimumBookCellWidth(viewportWidth = 0) { return viewportWidth >= 600 ? 18 : 16; }

/** Narrowest tappable width, in pixels, of any book. */
export function minimumBookTapWidth(viewportWidth = 0) { return minimumBookCellWidth(viewportWidth); }

/**
 * The tappable rectangle of a spine: `rect` (the projected, drawn spine) widened
 * symmetrically around its centre to at least `minWidth`, independent of how
 * thin the drawn book is. Height and vertical position are the spine's own.
 * Pass `out` to refresh a retained rectangle in place.
 */
export function padTapRect(rect, minWidth, out = {}) {
  const extra = Math.max(0, minWidth - rect.width);
  out.left = rect.left - extra / 2; out.top = rect.top;
  out.width = rect.width + extra; out.height = rect.height;
  return out;
}

/** Smallest side, in CSS pixels, of a lamp switch's tappable square: a
 * finger-sized target (a MITTLED puck is ~44 x 7 px, mostly behind a board). */
export const MINIMUM_LAMP_TAP_SIZE = tables.constants.minimumLampTapSize;

/** Like `padTapRect`, in both directions, to at least `minSize` square. */
export function padTapSquare(rect, minSize, out = {}) {
  const extraX = Math.max(0, minSize - rect.width), extraY = Math.max(0, minSize - rect.height);
  out.left = rect.left - extraX / 2; out.top = rect.top - extraY / 2;
  out.width = rect.width + extraX; out.height = rect.height + extraY;
  return out;
}

/**
 * Nearest-centre picking among padded tap rectangles: of the `targets`
 * containing (x, y), the one whose centre is nearest the point. Where two
 * padded rectangles overlap a tap goes to the book it is closest to. Null when
 * no rectangle contains the point.
 */
export function nearestTapTarget(targets, x, y) {
  let best = null, bestDistance = Infinity;
  for (const target of targets) {
    if (x < target.left || x > target.left + target.width || y < target.top || y > target.top + target.height) continue;
    const distance = (x - target.left - target.width / 2) ** 2 + ((y - target.top - target.height / 2) * .25) ** 2;
    if (distance < bestDistance) { bestDistance = distance; best = target; }
  }
  return best;
}

/** Plant size in scene pixels for a scale from `shelfScale`. */
export function plantSceneSize(plantId, potId, scale) {
  const size = plantDimensions(plantId, potId);
  return size ? { width:size.width * scale, height:size.height * scale, depth:size.depth * scale } : null;
}
