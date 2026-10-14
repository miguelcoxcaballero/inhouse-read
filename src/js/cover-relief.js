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
 * The numeric core is the only implementation of the maps, the palette and the
 * shading (there is no JavaScript twin: the frozen originals live in
 * tests/unit/helpers/reference-relief-*.js). The old family detectors (lettering,
 * foil, frame, emblem, band, varnish) had no production caller and live there too.
 */
import { runInSlices } from './cover-appearance.js';
import { getRustCore, loadRustCore } from './rust-core.js';
import { prepareColorMaskJob, countPreparedMaskPixels } from './cover-color-mask-wasm.js';
import { rustReliefPalette } from './relief-palette-wasm.js';
import { wasmInsideDistance, wasmBoxBlur, wasmHeightToNormals, wasmComposeMaterialMap, wasmComposeReliefLayers,
  wasmShadePreview, wasmReliefRgbaPlanes, wasmPigmentMaps } from './cover-relief-wasm.js';

export const COLOR_RELIEF_IDS = Object.freeze(Array.from({ length:10 }, (_, index) => `color-${index + 1}`));
export const LEGACY_RELIEF_IDS = Object.freeze(['lettering', 'foil', 'frame', 'emblem', 'varnish', 'band', 'grain', 'panel']);
export const RELIEF_IDS = Object.freeze([...COLOR_RELIEF_IDS, ...LEGACY_RELIEF_IDS]);
export const DEFAULT_RELIEF_STRENGTH = .75;
export const DEFAULT_COLOR_TOLERANCE = 6;
export const MIN_COLOR_TOLERANCE = 1;
export const MAX_COLOR_TOLERANCE = 12;
export const WORK_SIZE = 288;
export const MAP_SIZE = 512;

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

/** Validate portable color choices and old family records; discard map data. */
export function normalizeCoverRelief(value) {
  if (value && typeof value === 'object' && Array.isArray(value.layers)) {
    const layers = [], colors = new Set();
    for (const entry of value.layers.slice(0, 10)) {
      // Nested selections, legacy families and decoded rasters never become
      // layers. A portable layer names one actual supported printed colour.
      const layer = entry && !Array.isArray(entry.layers) && normalizeCoverRelief(entry);
      if (!layer || !COLOR_RELIEF_IDS.includes(layer.id) || colors.has(layer.color)) continue;
      layers.push(layer); colors.add(layer.color);
    }
    return layers.length ? { layers } : null;
  }
  if (!value || typeof value !== 'object' || !RELIEF_IDS.includes(value.id)) return null;
  const number = value.strength == null ? DEFAULT_RELIEF_STRENGTH : Number(value.strength);
  const strength = Number.isFinite(number) ? Math.round(clamp(number, 0, 1) * 100) / 100 : DEFAULT_RELIEF_STRENGTH;
  if (COLOR_RELIEF_IDS.includes(value.id)) {
    if (typeof value.color !== 'string' || !/^#[\da-f]{6}$/i.test(value.color)) return null;
    const tolerance = value.tolerance;
    if (!Number.isFinite(tolerance) || tolerance < MIN_COLOR_TOLERANCE || tolerance > MAX_COLOR_TOLERANCE) return null;
    return { id:value.id, color:value.color.toLowerCase(), tolerance:Math.round(tolerance * 100) / 100, strength };
  }
  return { id: value.id, strength };
}

/** Colour-only editor access. Legacy family choices remain readable and are
 * rendered through the first detected colour without being silently rewritten. */
export function coverReliefLayers(value) {
  const normalized = normalizeCoverRelief(value);
  if (normalized?.layers) return normalized.layers;
  return normalized && COLOR_RELIEF_IDS.includes(normalized.id) ? [normalized] : [];
}

// Each detected colour has its own stable printing/varnish depth and finish.
// These profiles never generate colour, a mask or a metallic pigment.
export function colorReliefProfile(choice) {
  // Slot ranks can change after a cover is reanalysed. The actual printed HEX
  // is the identity; its stable mix yields a bounded physical coating profile.
  let seed=parseInt(choice.color.slice(1),16);
  seed=Math.imul(seed^(seed>>>16),0x45d9f3b);
  seed=Math.imul(seed^(seed>>>16),0x45d9f3b);
  const fraction=((seed^(seed>>>16))>>>0)/0xffffffff;
  return { heightMM:.16 + fraction*.14, roughness:.012 + fraction*.018,
    clearcoatRoughness:.01 + fraction*.018 };
}

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

// The numeric core has no JavaScript twin. The page awaits it before its first
// shelf render, and every public entry point below waits for it as well; a
// kernel that rejects its input is an error, never a silent second path.
const unavailable = () => new Error('El módulo numérico no se pudo cargar. Recarga la página.');
const rust = () => getRustCore() ?? (() => { throw unavailable(); })();
async function ready() { if (!await loadRustCore()) throw unavailable(); }
function* native(task) {
  const result = yield* task;
  if (result === null) throw new TypeError('El núcleo de relieve no admite estos datos');
  return result;
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

function quantile(values, fraction) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

// ---- rasters -----------------------------------------------------------------

export function fitDimensions(width, height, long) {
  const scale = Math.min(1, long / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

// ---- actual printed colors --------------------------------------------------
// OKLab conversion follows Björn Ottosson's public-domain 2021 matrices:
// https://bottosson.github.io/posts/oklab/ . Distances below use OKLab * 100;
// they are Euclidean Delta-E OK values, not CIEDE2000 or RGB channel units.
const LINEAR_RGB = Float64Array.from({ length:256 }, (_, byte) => {
  const s = byte / 255;
  return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4;
});
function rgbToOklab(r, g, b) {
  r = LINEAR_RGB[r]; g = LINEAR_RGB[g]; b = LINEAR_RGB[b];
  const l = Math.cbrt(.4122214708 * r + .5363325363 * g + .0514459929 * b);
  const m = Math.cbrt(.2119034982 * r + .6806995451 * g + .1073969566 * b);
  const s = Math.cbrt(.0883024619 * r + .2817188376 * g + .6299787005 * b);
  return [100 * (.2104542553 * l + .7936177850 * m - .0040720468 * s),
    100 * (1.9779984951 * l - 2.4285922050 * m + .4505937099 * s),
    100 * (.0259040371 * l + .7827717662 * m - .8086757660 * s)];
}
const distance2 = (a, b) => (a[0]-b[0]) ** 2 + (a[1]-b[1]) ** 2 + (a[2]-b[2]) ** 2;
const hexOf = rgb => '#' + rgb.map(byte => byte.toString(16).padStart(2, '0')).join('');
const rgbOf = hex => [1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16));
function colorName(hex) {
  const [l, a, b] = rgbToOklab(...rgbOf(hex)), chroma = Math.hypot(a, b), hue = (Math.atan2(b, a) * 180 / Math.PI + 360) % 360;
  if (chroma < 3) return l < 20 ? 'Negro' : l > 95 ? 'Blanco' : l > 78 ? 'Gris claro' : l < 45 ? 'Gris oscuro' : 'Gris';
  if (l > 85 && chroma < 12 && hue >= 65 && hue < 125) return 'Crema';
  if (hue >= 45 && hue < 105 && l < 65) return 'Marrón';
  const name = hue < 45 || hue >= 355 ? 'Rojo' : hue < 90 ? 'Naranja' : hue < 125 ? 'Amarillo'
    : hue < 165 ? 'Verde' : hue < 220 ? 'Turquesa' : hue < 285 ? 'Azul' : hue < 330 ? 'Violeta' : 'Rosa';
  return name + (l < 42 ? ' oscuro' : l > 80 ? ' claro' : '');
}
function validateRaster(image) {
  if (!image || !Number.isSafeInteger(image.width) || !Number.isSafeInteger(image.height)
    || image.width < 1 || image.height < 1 || !image.data || image.data.length !== image.width * image.height * 4) {
    throw new TypeError('Portada sin píxeles RGBA válidos');
  }
}

/** Membership is recalculated from real pixels at the requested resolution.
 * No dilation/blur can include a pixel whose color is outside the stored ball.
 * Softening falls toward zero inside its radius, never over an adjacent ink. */
function* colorMask(image, color, tolerance) {
  const target = rgbToOklab(...rgbOf(color)), out = new Float32Array(image.width * image.height);
  const square = tolerance ** 2;
  for (let i = 0; i < out.length; i++) {
    const at = i * 4;
    if (image.data[at + 3] >= 128) {
      const d = distance2(target, rgbToOklab(image.data[at], image.data[at + 1], image.data[at + 2]));
      if (d < square) out[i] = (1 - smoothstep(tolerance * .72, tolerance, Math.sqrt(d))) * image.data[at + 3] / 255;
    }
    if ((i & 1023) === 1023) yield;
  }
  return out;
}

/** Up to ten distinct supported colors, never fabricated family suggestions.
 * Radii are less than half every inter-center distance, so all generated
 * choices remain disjoint even when recreated independently from persistence. */
// Measured with the complete bridge: small/one-/two-colour jobs keep their
// direct path; repeated classifications amortize the shared OKLab preparation.
const PREPARED_COLOR_MIN_LAYERS = 3, PREPARED_COLOR_MIN_PIXELS = 16384;
function* prepareColors(image, layers) {
  if (layers < PREPARED_COLOR_MIN_LAYERS || image.width * image.height < PREPARED_COLOR_MIN_PIXELS) return null;
  return yield* prepareColorMaskJob(rust(), image, rgbToOklab);
}
function* preparedColorMask(image, color, tolerance, prepared, countCoverage = false) {
  if (prepared) {
    const result = yield* prepared.mask(rgbToOklab(...rgbOf(color)), tolerance, countCoverage);
    if (result) return result;
  }
  return yield* colorMask(image, color, tolerance);
}

export function* analyzePixels(image) {
  validateRaster(image);
  const palette = yield* native(rustReliefPalette(rust(), image, rgbToOklab, true));
  if (!Number.isInteger(palette.seed)) throw new TypeError('El núcleo de relieve no admite estos datos');
  const { opaque, colors } = palette, chosen = [];
  let prepared = null;
  try {
    prepared = yield* prepareColors(image, colors.length);
    for (let index = 0; index < colors.length; index++) {
      const color = colors[index], nearest = Math.min(...colors.filter(other => other !== color).map(other => Math.sqrt(distance2(color.lab, other.lab))));
      const tolerance = Math.floor(Math.min(DEFAULT_COLOR_TOLERANCE, nearest * .45) * 100) / 100;
      const hex = hexOf(color.rgb), mask = yield* preparedColorMask(image, hex, tolerance, prepared, true);
      const pixels = yield* countPreparedMaskPixels(mask);
      chosen.push({ id:COLOR_RELIEF_IDS[index], color:hex, tolerance, strength:DEFAULT_RELIEF_STRENGTH,
        detected:true, confidence:1, recipe:{ kind:'color', color:hex, tolerance }, mask,
        facts:{ color:hex, coverage:pixels / Math.max(1, opaque), pixels } });
    }
    return { chosen, candidates:chosen, seed:palette.seed, feats:{ photo:false, busy:0, strokeFraction:0 },
      colorSpace:'oklab-100', opaquePixels:opaque };
  } finally { prepared?.dispose(); }
}

export function* buildMapsFromPixels(work, hires, selection) {
  validateRaster(work); validateRaster(hires);
  let choice = normalizeCoverRelief(selection);
  if (!choice) throw new TypeError('Color de relieve no válido');
  if (choice.layers) return yield* buildColorLayerMaps(hires, choice);
  // Preserve the old record id until the user chooses a color. Its renderer
  // uses the stable first actual color, never its old geometric/noise fallback.
  if (LEGACY_RELIEF_IDS.includes(choice.id)) choice = (yield* analyzePixels(work)).chosen[0];
  const { width, height } = hires, count = width * height;
  const out = { width, height, heightMap:new Uint8Array(count), foil:new Uint8Array(count),
    gloss:new Uint8Array(count), mask:new Uint8Array(count), preserveInk:true, foilColor:null };
  if (!choice) return out;
  const membership = yield* colorMask(hires, choice.color, choice.tolerance);
  Object.assign(out, yield* native(wasmPigmentMaps(rust(), membership, width, height)));
  out.color = choice.color; out.tolerance = choice.tolerance;
  return out;
}

function* buildColorLayerMaps(image, selection) {
  const { width, height } = image, count = width * height;
  // Canonical order makes overlapping externally supplied tolerances resolve
  // deterministically, independently of the order in which boxes were ticked.
  const layers = coverReliefLayers(selection).sort((a,b) => a.color.localeCompare(b.color));
  // Keep the unscaled physical height in float precision. Quantizing before
  // the per-colour strength would round two distinct coatings to one height.
  let owners = new Uint8Array(count), baseMask = new Uint8Array(count), baseHeight = new Float32Array(count);
  let prepared = null;
  try {
    prepared = yield* prepareColors(image, layers.length);
    for (let index = 0; index < layers.length; index++) {
      const layer = layers[index], membership = yield* preparedColorMask(image, layer.color, layer.tolerance, prepared);
      const profile = colorReliefProfile(layer);
      // A pixel belongs to exactly one selected pigment; contributions cannot
      // add brightness/height or spill into another pigment on overlap.
      ({ owners, baseMask, baseHeight } = yield* native(wasmPigmentMaps(rust(), membership, width, height,
        { owners, baseMask, baseHeight, owner:index + 1, heightMM:profile.heightMM })));
    }
    // Classification is complete; composition needs only owned maps.
    prepared?.dispose(); prepared = null;
    return yield* composeReliefLayerPixels({ width,height,preserveInk:true,foilColor:null,
      owners,baseMask,baseHeight,layers }, selection);
  } finally { prepared?.dispose(); }
}

/** Reuse the classified colour ownership while adjusting a layer's intensity.
 * Only three bounded output planes are allocated; no image decode, clustering
 * or per-layer GPU textures are needed on slider updates. */
export function* composeReliefLayerPixels(maps, selection) {
  const layers=coverReliefLayers(selection).sort((a,b)=>a.color.localeCompare(b.color));
  if (!maps.owners || layers.length!==maps.layers.length || layers.some((layer,index)=>
    layer.color!==maps.layers[index].color || layer.tolerance!==maps.layers[index].tolerance)) {
    throw new TypeError('Las zonas de relieve han cambiado');
  }
  return yield* native(wasmComposeReliefLayers(rust(), maps, layers));
}

// ---- shading: the preview card and the material maps ----------------------------------

const MM_FULL_COVER = 200; // a cover is about 20 cm tall

/** Tangent-space normals (RGBA bytes) from the height map; +x right, +y up the cover. */
export function* heightToNormals(maps, { gain = 1, selectionAlpha = false } = {}) {
  const { width, height } = maps;
  const mmPerPixel = MM_FULL_COVER / Math.max(width, height), unit = MAX_RELIEF_MM / 255 / (2 * mmPerPixel) * gain;
  return yield* native(wasmHeightToNormals(rust(), maps, unit, { selectionAlpha }));
}

/** Packed R clearcoat, G roughness ratio, B metalness, A clearcoat-roughness
 * ratio. Color masks use B=0 and leave the original ink/base finish intact.
 * Generic old map fixtures retain their foil channel and opaque alpha. */
export function* composeMaterialMap(maps, { clearcoat = 0, roughness = .5, clearcoatRoughness = .18 } = {}) {
  const base = clamp(clearcoat, 0, 1), foilRoughness = clamp(.3 / Math.max(.05, roughness), .2, 1);
  const glossRoughness = clamp(.05 / Math.max(.01, roughness), 0, 1);
  const glossCoatRoughness = clamp(.05 / Math.max(.01, clearcoatRoughness), 0, 1);
  const profiles=maps.layers?.map(layer=>{
    const profile=colorReliefProfile(layer);
    return { roughness:clamp(profile.roughness/Math.max(.01,roughness),0,1),
      clearcoatRoughness:clamp(profile.clearcoatRoughness/Math.max(.01,clearcoatRoughness),0,1) };
  });
  return yield* native(wasmComposeMaterialMap(rust(), maps,
    { base, foilRoughness, glossRoughness, glossCoatRoughness, profiles }));
}

/** Shaded preview, lit from the top-left, as RGBA bytes (pure; the browser
 * wrapper only turns it into a data URL). Foil zones glint, gloss zones shine. */
export function* shadePreview(image, maps, { slope = 7 } = {}) {
  return yield* native(wasmShadePreview(rust(), image, maps, slope * MAX_RELIEF_MM / 255 * 14));
}

// ---- browser wrapper ----------------------------------------------------------------------

async function decode(source, signal) {
  if (signal?.aborted) throw abortError();
  if (typeof source !== 'string') return source;
  if (typeof Image === 'undefined') throw new Error('Sin imágenes en este entorno');
  const image = new Image();
  image.decoding = 'async';
  let timer, onAbort;
  const loaded = typeof image.decode === 'function' ? null : new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () => reject(new Error('No se pudo leer la portada'));
  });
  image.src = source;
  try {
    await Promise.race([
      loaded ?? image.decode(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('La portada tardó demasiado')), 4000); }),
      new Promise((_, reject) => {
        onAbort = () => reject(abortError());
        signal?.addEventListener('abort', onAbort, { once: true });
        if (signal?.aborted) onAbort();
      })
    ]);
    if (signal?.aborted) throw abortError();
    return image;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
    image.onload = image.onerror = null;
  }
}

function dimensionsOf(drawable) {
  return { width: drawable.naturalWidth || drawable.videoWidth || drawable.displayWidth || drawable.width,
    height: drawable.naturalHeight || drawable.videoHeight || drawable.displayHeight || drawable.height };
}

function raster(drawable, long, { sampleColors = false } = {}) {
  const natural = dimensionsOf(drawable), size = fitDimensions(natural.width, natural.height, long);
  const canvas = document.createElement('canvas');
  canvas.width = size.width; canvas.height = size.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  // Analysis samples actual pixels, without manufacturing blend colors along
  // two-color edges. Map/preview resizing retains the existing high quality.
  context.imageSmoothingEnabled = !sampleColors; context.imageSmoothingQuality = 'high';
  context.drawImage(drawable, 0, 0, size.width, size.height);
  const { data } = context.getImageData(0, 0, size.width, size.height);
  // Preserve alpha: transparent cutouts/board padding are excluded from colors.
  return { data, width: size.width, height: size.height };
}

function toCanvas(rgba, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  canvas.getContext('2d').putImageData(new ImageData(rgba, width, height), 0, 0);
  return canvas;
}

async function thumbnailOf(work, maps, run) {
  const shaded = await run(shadePreview(work, maps, { slope: maps.soft ? 2.2 : 7 })), canvas = toCanvas(shaded, work.width, work.height);
  const scale = Math.min(1, 132 / work.width), small = document.createElement('canvas');
  small.width = Math.max(1, Math.round(work.width * scale)); small.height = Math.max(1, Math.round(work.height * scale));
  const context = small.getContext('2d');
  context.imageSmoothingQuality = 'high';
  context.drawImage(canvas, 0, 0, small.width, small.height);
  return small.toDataURL('image/jpeg', .82);
}

const pct = value => `${Math.max(1, Math.round(value * 100))}%`;
const describe = candidate => ({ label:colorName(candidate.color),
  description:`Zonas de este color (${pct(candidate.facts.coverage)} de la portada), con relieve y brillo` });

/** Find, rank and preview up to ten actual color proposals (URL or decoded
 * image). Returns fewer choices for covers with fewer supported colors. Heavy
 * loops run in main-thread slices; pass `signal` to cancel. */
export async function analyzeCoverRelief(coverUrl, { title = '', author = '', signal, previews = true } = {}) {
  void title; void author; // the picture decides: names never add a claim the pixels do not support
  const stats = { slices: 0, longestSliceMs: 0, ms: 0, durations: [] };
  const [drawable] = await Promise.all([decode(coverUrl, signal), ready()]);
  const work = raster(drawable, WORK_SIZE, { sampleColors:true });
  const found = await runSliced(analyzePixels(work), { signal, stats });
  // Ten choices must not multiply full-size map construction. The small
  // thumbnails only illustrate the selected ink; the model independently
  // rebuilds its physical mask at the appropriate rendering resolution.
  const preview = previews ? raster(drawable, 96, { sampleColors:true }) : null;
  const proposals = [];
  for (const choice of found.chosen) {
    const maps = preview ? await runSliced(buildMapsFromPixels(work, preview, choice), { signal, stats }) : null;
    const { label, description } = describe(choice);
    proposals.push({ id: choice.id, color:choice.color, tolerance:choice.tolerance, label, description, strength:DEFAULT_RELIEF_STRENGTH,
      thumbnail: preview ? await thumbnailOf(preview, maps, task => runSliced(task, { signal, stats })) : '', confidence: Math.round(choice.confidence * 100) / 100, detected: choice.detected });
  }
  return { proposals, analysis: { width: work.width, height: work.height, seed: found.seed, colorSpace:found.colorSpace, photo: found.feats.photo,
    busy: Math.round(found.feats.busy * 1000) / 1000, strokeFraction: Math.round(found.feats.strokeFraction * 1000) / 1000,
    candidates: found.candidates.map(item => ({ id: item.id, confidence: Math.round(item.confidence * 100) / 100, facts: item.facts })),
    ms: Math.round(stats.ms), slices: stats.slices, longestSliceMs: Math.round(stats.longestSliceMs * 10) / 10,
    medianSliceMs: Math.round(quantile(stats.durations, .5) * 10) / 10, p95SliceMs: Math.round(quantile(stats.durations, .95) * 10) / 10 } };
}

/** The maps of one relief choice for a cover: `height` (bytes, in
 * MAX_RELIEF_MM units), `foil` and `gloss` canvases at the cover's aspect,
 * plus `normal` (tangent-space RGBA) ready for a texture. A saved HEX/radius is
 * classified directly at map resolution, without re-centering/re-clustering.
 * Legacy ids resolve to the first supported color but do not rewrite data. */
export async function buildReliefMaps(coverUrl, relief, { maxSize = MAP_SIZE, signal, selectionAlpha = false } = {}) {
  const choice = normalizeCoverRelief(relief);
  if (!choice) return null;
  const stats = { slices: 0, longestSliceMs: 0, ms: 0 };
  const [drawable] = await Promise.all([decode(coverUrl, signal), ready()]);
  const hires = raster(drawable, clamp(maxSize, 64, MAP_SIZE));
  const work = choice.layers || COLOR_RELIEF_IDS.includes(choice.id) ? hires : raster(drawable, WORK_SIZE, { sampleColors:true });
  const maps = await runSliced(buildMapsFromPixels(work, hires, choice), { signal, stats });
  const normal = await runSliced(heightToNormals(maps, { selectionAlpha }), { signal, stats });
  const planes = reliefPlanesToRgba(maps);
  return { height: new ImageData(planes.height, maps.width, maps.height),
    foil: new ImageData(planes.foil, maps.width, maps.height), gloss: new ImageData(planes.gloss, maps.width, maps.height),
    normal, ...(selectionAlpha ? { normalSelectionAlpha: true } : {}), pixels: maps, size: { width: maps.width, height: maps.height }, foilColor: maps.foilColor,
    stats: { ms: Math.round(stats.ms), longestSliceMs: stats.longestSliceMs, slices: stats.slices } };
}

/** Recompose installed multicolour maps from the same stored classification.
 * The returned normal/pixels are separate, so a cancelled bake cannot mutate
 * the cover that remains on screen. */
export async function updateReliefMapStrengths(built, selection, { signal } = {}) {
  await ready();
  const pixels=await runSliced(composeReliefLayerPixels(built.pixels,selection),{signal});
  const normal=await runSliced(heightToNormals(pixels,{selectionAlpha:built.normalSelectionAlpha === true}),{signal});
  return { ...built,pixels,normal };
}

/** Convert the three material planes together without changing their pixel data. */
export function reliefPlanesToRgba(maps) {
  const planes = wasmReliefRgbaPlanes(rust(), maps);
  if (!planes) throw new TypeError('El núcleo de relieve no admite estos datos');
  return planes;
}

/** Pure steps the tests reach into: the original colour maths and the two
 * distance/blur kernels. */
export const internals = { rgbToOklab, colorMask, colorName, raster,
  *insideDistance(mask, width, height) { return yield* native(wasmInsideDistance(rust(), mask, width, height)); },
  *boxBlur(field, width, height, radius) { return radius < 1 ? field : yield* native(wasmBoxBlur(rust(), field, width, height, radius)); } };
