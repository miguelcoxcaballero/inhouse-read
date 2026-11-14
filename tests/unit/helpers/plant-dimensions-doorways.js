// src/js/plant-dimensions.js plus the doorways into the Rust shelf module that only tests ever went through: they left
// the app's source. The shelf picks a tapped book among packed rectangles in the module (scene_nearest_tap), and nothing
// in the app asks for a species' standard class or a plant's size in scene pixels by these names. The Rust functions
// are the ones production's module exports; the tests that compare them with the frozen originals keep doing so here.
export * from '../../../src/js/plant-dimensions.js';
import { minimumBookCellWidth } from '../../../src/js/plant-dimensions.js';
import { tables } from '../../../src/js/decor-catalogue.js';
import { needRustShelf } from '../../../src/js/rust-shelf.js';

/** Largest IKEA size class of a species that fits under PLANT_MAX_HEIGHT_MM (the smallest class, flagged `fits:false`,
 * if none does). */
export function standardPlantClass(plantId) { return needRustShelf().plant_standard_class(tables, plantId); }
/** Plant size in scene pixels for a scale from `shelfScale`. */
export function plantSceneSize(plantId, potId, scale) { return needRustShelf().plant_scene_dimensions(tables, plantId, potId, scale); }
/** Narrowest tappable width, in pixels, of any book. */
export function minimumBookTapWidth(viewportWidth = 0) { return minimumBookCellWidth(viewportWidth); }
/** The tappable rectangle of a spine: `rect` widened symmetrically around its centre to at least `minWidth`. Pass `out`
 * to refresh a retained rectangle in place. */
export function padTapRect(rect, minWidth, out = {}) { return needRustShelf().plant_pad_tap(rect, minWidth, out, false); }
/** Like `padTapRect`, in both directions, to at least `minSize` square. */
export function padTapSquare(rect, minSize, out = {}) { return needRustShelf().plant_pad_tap(rect, minSize, out, true); }
/** Of the `targets` containing (x, y), the one whose centre is nearest the point; null when none contains it. */
export function nearestTapTarget(targets, x, y) { return needRustShelf().plant_nearest_tap(targets, x, y); }
