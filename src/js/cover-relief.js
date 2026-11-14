/*
 * Cover relief selects up to ten actual colors printed on a cover. Each
 * portable HEX/tolerance choice recreates an exclusive, conservatively soft
 * height/gloss mask; it never recolors ink or invents borders, grain or foil.
 *
 * Everything here is local, deterministic perceptual clustering (no network,
 * no model). The analysis is split into pure generator functions over RGBA
 * arrays, so Node can test them; they `yield` every few rows so the browser
 * wrapper can hand the main thread back (runInSlices) and stop on an abort.
 * Working rasters are bounded: 288 px on the long side to find things, at
 * most 512 px to build the maps.
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
 * shading: every pass is a job of rust-ui/src/relief_job.rs, stepped here so the
 * main thread gets its pauses (there is no JavaScript twin: the frozen originals
 * live in tests/unit/helpers/reference-relief-*.js, the frozen bridge to the
 * numeric core in reference-cover-relief-wasm.js). The old family detectors
 * (lettering, foil, frame, emblem, band, varnish) had no production caller and
 * live there too.
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

// ---- generators ------------------------------------------------------------

/** Run a generator to its end synchronously (tests, and callers that must not wait). */
export function drain(task) {
  for (let step = task.next(); ; step = task.next()) if (step.done) return step.value;
}

function abortError() {
  const error = new Error('Análisis cancelado');
  error.name = 'AbortError';
  return error;
}

/** Wrap a generator so it throws at the first safe point after `signal` aborts. */
function* abortable(task, signal) {
  try {
    for (let step = task.next(); ; step = task.next()) {
      if (signal?.aborted) throw abortError();
      if (step.done) return step.value;
      yield;
    }
  } finally { task.return?.(); }
}

// The passes have no JavaScript twin. The page awaits the shelf module before its
// first shelf render, and every public entry point below waits for it as well; a
// job that rejects its input is an error, never a silent second path.
const unavailable = () => new Error('El módulo numérico no se pudo cargar. Recarga la página.');
async function ready() { if (!await loadRustShelf()) throw unavailable(); }
/** Step a job of the shelf module to its end, pausing where it asks; it is freed however this ends. */
function* run(make) {
  const job = make(needRustShelf().ReliefJob);
  try { for (let code; (code = job.step()) !== 0;) { if (code < 0) throw job.error(); yield; } return job.result(); }
  finally { job.free(); }
}

/** Run in main-thread slices; reports the longest slice and the slice count. */
async function runSliced(task, { signal, stats } = {}) {
  if (signal?.aborted) throw abortError();
  const started = typeof performance !== 'undefined' ? performance.now() : 0;
  const onSlice = duration => { if (stats) { stats.slices++; stats.longestSliceMs = Math.max(stats.longestSliceMs, duration); stats.durations?.push(duration); } };
  const value = await runInSlices(abortable(task, signal), undefined, onSlice);
  if (stats && typeof performance !== 'undefined') stats.ms += performance.now() - started;
  return value;
}

// ---- rasters -----------------------------------------------------------------

export const fitDimensions = (width, height, long) => needRustShelf().relief_fit_dimensions(width, height, long);

// ---- actual printed colors --------------------------------------------------
// The core converts to OKLab (Björn Ottosson's public-domain 2021 matrices,
// https://bottosson.github.io/posts/oklab/), finds the palette, classifies every pixel against the ball of
// each colour and builds the pigment maps (rust-core/src/cover_relief.rs). Distances are Euclidean OKLab * 100
// (Delta-E OK), not CIEDE2000 or RGB channel units.
const colorName = hex => needRustShelf().relief_color_name(hex);
const validateRaster = image => needRustShelf().relief_validate_raster(image);

/** Up to ten distinct supported colors, never fabricated family suggestions. Radii are less than half every
 * inter-center distance, so all generated choices remain disjoint even when recreated independently from
 * persistence. Membership is recalculated from real pixels (no dilation/blur can include a pixel whose color is
 * outside the stored ball) and falls toward zero inside its radius, never over an adjacent ink. */
export function* analyzePixels(image) { return yield* run(Job => Job.analysis(image)); }

export function* buildMapsFromPixels(work, hires, selection) {
  validateRaster(work); validateRaster(hires);
  let choice = normalizeCoverRelief(selection);
  if (!choice) throw new TypeError('Color de relieve no válido');
  const mode = needRustShelf().relief_map_mode(choice);
  if (mode === 2) return yield* buildColorLayerMaps(hires, choice);
  // Preserve the old record id until the user chooses a color. Its renderer
  // uses the stable first actual color, never its old geometric/noise fallback.
  if (mode === 0) choice = (yield* analyzePixels(work)).chosen[0];
  const { width, height } = hires, count = width * height;
  const out = { width, height, heightMap:new Uint8Array(count), foil:new Uint8Array(count),
    gloss:new Uint8Array(count), mask:new Uint8Array(count), preserveInk:true, foilColor:null };
  if (!choice) return out;
  Object.assign(out, yield* run(Job => Job.maps(hires, [{ color:choice.color, tolerance:choice.tolerance }], true)));
  out.color = choice.color; out.tolerance = choice.tolerance;
  return out;
}

function* buildColorLayerMaps(image, selection) {
  const { width, height } = image;
  // Canonical order makes overlapping externally supplied tolerances resolve
  // deterministically, independently of the order in which boxes were ticked.
  const layers = needRustShelf().relief_sorted_layers(selection);
  // A pixel belongs to exactly one selected pigment; contributions cannot add brightness/height or spill into
  // another pigment on overlap. The unscaled physical height keeps float precision: quantizing before the
  // per-colour strength would round two distinct coatings to one height.
  const classified = needRustShelf().relief_classification_layers(layers);
  const { owners, baseMask, baseHeight } = yield* run(Job => Job.maps(image, classified, false));
  // Classification is complete; composition needs only owned maps.
  return yield* composeReliefLayerPixels({ width,height,preserveInk:true,foilColor:null,
    owners,baseMask,baseHeight,layers }, selection);
}

/** Reuse the classified colour ownership while adjusting a layer's intensity.
 * Only three bounded output planes are allocated; no image decode, clustering
 * or per-layer GPU textures are needed on slider updates. */
export function* composeReliefLayerPixels(maps, selection) { return yield* run(Job => Job.compose(maps, selection)); }

// ---- shading: the preview card and the material maps ----------------------------------

/** Tangent-space normals (RGBA bytes) from the height map; +x right, +y up the cover. */
export function* heightToNormals(maps, { gain = 1, selectionAlpha = false } = {}) {
  const { width, height } = maps;
  const unit = needRustShelf().relief_normal_unit(width, height, gain);
  return yield* run(Job => Job.normals(maps, unit, selectionAlpha));
}

/** Packed R clearcoat, G roughness ratio, B metalness, A clearcoat-roughness
 * ratio. Color masks use B=0 and leave the original ink/base finish intact.
 * Generic old map fixtures retain their foil channel and opaque alpha. */
export function* composeMaterialMap(maps, { clearcoat = 0, roughness = .5, clearcoatRoughness = .18 } = {}) {
  return yield* run(Job => Job.material(maps, clearcoat, roughness, clearcoatRoughness));
}

/** Shaded preview, lit from the top-left, as RGBA bytes (pure; the browser
 * wrapper only turns it into a data URL). Foil zones glint, gloss zones shine. */
export function* shadePreview(image, maps, { slope = 7 } = {}) {
  return yield* run(Job => Job.preview(image, maps, slope));
}

// ---- browser wrapper ----------------------------------------------------------------------
// The bounded decode, the working rasters, the thumbnails and the three flows below are the shelf module's
// (rust-ui/src/relief_flow.rs), promise for promise; it is handed the generators above and the slice driver.
const host = { normalize:normalizeCoverRelief, ready, sliced:(task, signal, stats) => runSliced(task, { signal, stats }),
  analysis:analyzePixels, maps:buildMapsFromPixels, render:(...args) => run(Job => Job.render(...args)),
  preview:(image, maps, slope) => shadePreview(image, maps, { slope }) };
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
