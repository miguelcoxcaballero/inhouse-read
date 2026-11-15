/*
 * Cover relief selects up to ten actual colors printed on a cover. Each
 * portable HEX/tolerance choice recreates an exclusive, conservatively soft
 * height/gloss mask; it never recolors ink or invents borders, grain or foil.
 *
 * Everything here is local, deterministic perceptual clustering (no network,
 * no model). Working rasters are bounded: 288 px on the long side to find
 * things, at most 512 px to build the maps.
 *
 * A saved choice is `{ id:'color-1'..'color-10', color:'#rrggbb',
 * tolerance, strength }`; tolerance is Euclidean OKLab * 100 (1..12). Maps
 * are never persisted. `{ layers:[choice,...] }` combines up to ten colours
 * with independent intensities; HEX identifies a layer even if slot ranks
 * change on reanalysis. Uniform/bicolor covers have one/two choices. Legacy
 * family records remain readable and render their first real dominant color;
 * the original record is only replaced by an explicit new user selection.
 *
 * The shelf module is the only implementation of the maps, the palette and the
 * shading: every pass is a job of rust-ui/src/relief_job.rs, made and stepped by
 * the flows of rust-ui/src/relief_flow.rs inside the page's slice driver, which
 * hands the main thread back between slices; a flow stops at the first step
 * after its signal aborts. The frozen originals live in
 * tests/unit/helpers/reference-relief-*.js and reference-cover-relief-flow.js;
 * tests reach one pass on its own through tests/unit/helpers/relief-passes.js.
 */
import { runInSlices } from './cover-appearance.js';
import { needRustShelf, loadRustShelf } from './rust-shelf.js';
import { bookDataModule } from './book-data-native.js';

export const COLOR_RELIEF_IDS = Object.freeze(Array.from({ length:10 }, (_, index) => `color-${index + 1}`));
export const LEGACY_RELIEF_IDS = Object.freeze(['lettering', 'foil', 'frame', 'emblem', 'varnish', 'band', 'grain', 'panel']);
export const RELIEF_IDS = Object.freeze([...COLOR_RELIEF_IDS, ...LEGACY_RELIEF_IDS]);
export const DEFAULT_RELIEF_STRENGTH = .75;
export const DEFAULT_COLOR_TOLERANCE = 6;
export const MIN_COLOR_TOLERANCE = 1;
export const MAX_COLOR_TOLERANCE = 12;
export const WORK_SIZE = 288;
export const MAP_SIZE = 512;

/** Validate portable color choices and old family records; discard map data. */
export const normalizeCoverRelief = value => bookDataModule().normalize_cover_relief(value);

/** Colour-only editor access; legacy records keep their original identity. */
export const coverReliefLayers = value => bookDataModule().cover_relief_layers(value);

// Each detected colour has its own stable printing/varnish depth and finish, from its printed HEX (slot ranks
// can change after a cover is reanalysed). These profiles never generate colour, a mask or a metallic pigment.
// The mix, the colour names and the material coefficients are rust-ui/src/cover_relief.rs (the `shelf` module).
export const colorReliefProfile = choice => needRustShelf().color_relief_profile(choice);

// Maps store physical height in units of MAX_RELIEF_MM. New color zones use
// .30 mm before the renderer's strength multiplier for existing singles;
// combined colours have their own stable .16–.30 mm coating profiles.
export const MAX_RELIEF_MM = .6;

// The passes have no JavaScript twin. The page awaits the shelf module before its
// first shelf render, and every public entry point below waits for it as well; a
// job that rejects its input is an error, never a silent second path.
const unavailable = () => new Error('El módulo numérico no se pudo cargar. Recarga la página.');
async function ready() { if (!await loadRustShelf()) throw unavailable(); }

// ---- rasters -----------------------------------------------------------------

export const fitDimensions = (width, height, long) => needRustShelf().relief_fit_dimensions(width, height, long);

// ---- actual printed colors --------------------------------------------------
// The core converts to OKLab (Björn Ottosson's public-domain 2021 matrices,
// https://bottosson.github.io/posts/oklab/), finds the palette, classifies every pixel against the ball of
// each colour and builds the pigment maps (rust-core/src/cover_relief.rs). Distances are Euclidean OKLab * 100
// (Delta-E OK), not CIEDE2000 or RGB channel units.
const colorName = hex => needRustShelf().relief_color_name(hex);

// ---- browser wrapper ----------------------------------------------------------------------
// The bounded decode, the working rasters, the passes, the thumbnails and the three flows below are the shelf
// module's (rust-ui/src/relief_flow.rs), promise for promise; it is handed the slice driver.
const host = { normalize:normalizeCoverRelief, ready, slices:runInSlices };
function flow(name, ...args) {
  let shelf;
  try { shelf = needRustShelf(); } catch { return ready().then(() => needRustShelf()[name](host, ...args)); }
  return shelf[name](host, ...args);
}

/** Find, rank and preview up to ten actual color proposals (URL or decoded
 * image). Returns fewer choices for covers with fewer supported colors. Heavy
 * loops run in main-thread slices; pass `signal` to cancel. */
export const analyzeCoverRelief = (coverUrl, options) => flow('relief_analyze_cover', coverUrl, options);

/** The maps of one relief choice for a cover: `height` (bytes, in
 * MAX_RELIEF_MM units), `foil` and `gloss` canvases at the cover's aspect,
 * plus `normal` (tangent-space RGBA) ready for a texture. A saved HEX/radius is
 * classified directly at map resolution, without re-centering/re-clustering.
 * Legacy ids resolve to the first supported color but do not rewrite data. */
export const buildReliefMaps = (coverUrl, relief, options) => flow('relief_build_maps', coverUrl, relief, options);

/** Recompose installed multicolour maps from the same stored classification.
 * The returned normal/pixels are separate, so a cancelled bake cannot mutate
 * the cover that remains on screen. */
export const updateReliefMapStrengths = (built, selection, options) => flow('relief_update_strengths', built, selection, options);

/** Convert the three material planes together without changing their pixel data. */
export const reliefPlanesToRgba = maps => needRustShelf().relief_planes_rgba(maps);

/** Pure steps the tests reach into: the colour naming. */
export const internals = { colorName };
