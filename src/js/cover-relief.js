/*
 * Cover relief: which parts of a printed cover could carry embossing, foil
 * or spot varnish on a real book, and the height / foil / gloss maps that
 * the 3D cover turns into raised, shiny zones.
 *
 * Everything here is a local, deterministic heuristic on pixels (no network,
 * no model). The analysis is split into pure generator functions over RGBA
 * arrays, so Node can test them; they `yield` every few rows so the browser
 * wrapper can hand the main thread back (runInSlices) and stop on an abort.
 * Working rasters are bounded: 288 px on the long side to find things, at
 * most 512 px to build the maps.
 *
 * A proposal is identified by a fixed family id, never by a stored map: the
 * same cover always yields the same three proposals and the same maps, so a
 * saved `{ id, strength }` is regenerated at load time.
 */
import { runInSlices } from './cover-appearance.js';

export const RELIEF_IDS = Object.freeze(['lettering', 'foil', 'frame', 'emblem', 'varnish', 'band', 'grain', 'panel']);
export const DEFAULT_RELIEF_STRENGTH = .75;
export const WORK_SIZE = 288;
export const MAP_SIZE = 512;
const CONFIDENT = .3;

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

/** Persistence validation: a known id and a strength in 0..1, or null. */
export function normalizeCoverRelief(value) {
  if (!value || typeof value !== 'object' || !RELIEF_IDS.includes(value.id)) return null;
  const number = value.strength == null ? DEFAULT_RELIEF_STRENGTH : Number(value.strength);
  const strength = Number.isFinite(number) ? Math.round(clamp(number, 0, 1) * 100) / 100 : DEFAULT_RELIEF_STRENGTH;
  return { id: value.id, strength };
}

// Physical height of the raised zones, in millimetres, by family. The maps
// store height in units of MAX_RELIEF_MM, so 255 is the tallest possible.
export const MAX_RELIEF_MM = .6;
const FAMILIES = Object.freeze({
  lettering: { mm: .30, strength: .8, order: 1 },
  foil: { mm: .28, strength: .8, order: 0 },
  frame: { mm: .28, strength: .7, order: 2 },
  emblem: { mm: .45, strength: .8, order: 3 },
  varnish: { mm: .12, strength: .6, order: 5 },
  band: { mm: .22, strength: .7, order: 4 },
  grain: { mm: .12, strength: .55, order: 7 },
  panel: { mm: .35, strength: .7, order: 6 }
});

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
  for (let step = task.next(); ; step = task.next()) {
    if (signal?.aborted) throw abortError();
    if (step.done) return step.value;
    yield;
  }
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

export function fitDimensions(width, height, long) {
  const scale = Math.min(1, long / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** FNV-1a over a coarse 24-column sample of the pixels: same cover, same seed. */
export function seedOf(image) {
  const { data, width, height } = image;
  let state = 2166136261;
  const stepX = Math.max(1, Math.floor(width / 24)), stepY = Math.max(1, Math.floor(height / 36));
  for (let y = 0; y < height; y += stepY) for (let x = 0; x < width; x += stepX) {
    const at = (y * width + x) * 4;
    // Quantised so that a re-encode of the same picture keeps the seed.
    state = Math.imul(state ^ (data[at] >> 4), 16777619);
    state = Math.imul(state ^ (data[at + 1] >> 4), 16777619);
    state = Math.imul(state ^ (data[at + 2] >> 4), 16777619);
  }
  return state >>> 0;
}

function hash2(x, y, seed) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// ---- morphology --------------------------------------------------------------

function* rank(source, width, height, radius, takeMax) {
  const middle = new Uint8Array(source.length), out = new Uint8Array(source.length);
  const start = takeMax ? 0 : 255;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      let value = start;
      const from = Math.max(0, x - radius), to = Math.min(width - 1, x + radius);
      if (takeMax) for (let i = from; i <= to; i++) { if (source[row + i] > value) value = source[row + i]; }
      else for (let i = from; i <= to; i++) { if (source[row + i] < value) value = source[row + i]; }
      middle[row + x] = value;
    }
    if ((y & 15) === 15) yield;
  }
  for (let y = 0; y < height; y++) {
    const from = Math.max(0, y - radius), to = Math.min(height - 1, y + radius), row = y * width;
    for (let x = 0; x < width; x++) {
      let value = start;
      if (takeMax) for (let j = from; j <= to; j++) { if (middle[j * width + x] > value) value = middle[j * width + x]; }
      else for (let j = from; j <= to; j++) { if (middle[j * width + x] < value) value = middle[j * width + x]; }
      out[row + x] = value;
    }
    if ((y & 15) === 15) yield;
  }
  return out;
}

/** Binary opening/closing on 0/1 masks (kept as 0/255 planes while ranking). */
function* openMask(mask, width, height, radius) {
  const plane = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) plane[i] = mask[i] ? 255 : 0;
  const eroded = yield* rank(plane, width, height, radius, false);
  const opened = yield* rank(eroded, width, height, radius, true);
  const out = new Uint8Array(mask.length);
  for (let i = 0; i < out.length; i++) out[i] = opened[i] > 127 ? 1 : 0;
  return out;
}

function* closeMask(mask, width, height, radius) {
  const plane = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) plane[i] = mask[i] ? 255 : 0;
  const dilated = yield* rank(plane, width, height, radius, true);
  const closed = yield* rank(dilated, width, height, radius, false);
  const out = new Uint8Array(mask.length);
  for (let i = 0; i < out.length; i++) out[i] = closed[i] > 127 ? 1 : 0;
  return out;
}

function* dilateMask(mask, width, height, radius) {
  const plane = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) plane[i] = mask[i] ? 255 : 0;
  const dilated = yield* rank(plane, width, height, radius, true);
  const out = new Uint8Array(mask.length);
  for (let i = 0; i < out.length; i++) out[i] = dilated[i] > 127 ? 1 : 0;
  return out;
}

/** 4-connected components of a 0/1 mask, with area, bounding box and centroid. */
function* components(mask, width, height) {
  const labels = new Int32Array(mask.length), list = [], stack = new Int32Array(mask.length);
  let popped = 0;
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || labels[start]) continue;
    const id = list.length + 1;
    let top = 0, area = 0, x0 = width, y0 = height, x1 = -1, y1 = -1, sx = 0, sy = 0;
    stack[top++] = start; labels[start] = id;
    while (top) {
      const at = stack[--top], x = at % width, y = (at - x) / width;
      area++; sx += x; sy += y;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x > 0 && mask[at - 1] && !labels[at - 1]) { labels[at - 1] = id; stack[top++] = at - 1; }
      if (x < width - 1 && mask[at + 1] && !labels[at + 1]) { labels[at + 1] = id; stack[top++] = at + 1; }
      if (y > 0 && mask[at - width] && !labels[at - width]) { labels[at - width] = id; stack[top++] = at - width; }
      if (y < height - 1 && mask[at + width] && !labels[at + width]) { labels[at + width] = id; stack[top++] = at + width; }
      if ((++popped & 8191) === 0) yield;
    }
    list.push({ id, area, x0, y0, x1, y1, cx: sx / area, cy: sy / area });
  }
  return { labels, list };
}

// ---- features -----------------------------------------------------------------

function rgbToHsv(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  let hue = 0;
  if (delta) {
    if (max === r) hue = 60 * (((g - b) / delta) % 6);
    else if (max === g) hue = 60 * ((b - r) / delta + 2);
    else hue = 60 * ((r - g) / delta + 4);
    if (hue < 0) hue += 360;
  }
  return [hue, max ? delta / max : 0, max / 255];
}

/** Thin-stroke contrast: white and black top-hats of every channel at a thin
 * and a thicker scale, so lettering, rules and ornaments stand out from the
 * flat colour around them while large fields and gradients do not. */
function* strokeContrast(image) {
  const { data, width, height } = image, count = width * height, bright = new Uint8Array(count), dark = new Uint8Array(count);
  const long = Math.max(width, height), radii = [Math.max(2, Math.round(long * .0105)), Math.max(4, Math.round(long * .028))];
  for (let channel = 0; channel < 3; channel++) {
    const plane = new Uint8Array(count);
    for (let i = 0; i < count; i++) plane[i] = data[i * 4 + channel];
    for (const radius of radii) {
      const opened = yield* rank(yield* rank(plane, width, height, radius, false), width, height, radius, true);
      const closed = yield* rank(yield* rank(plane, width, height, radius, true), width, height, radius, false);
      for (let i = 0; i < count; i++) {
        const light = plane[i] - opened[i], shade = closed[i] - plane[i];
        if (light > bright[i]) bright[i] = light;
        if (shade > dark[i]) dark[i] = shade;
      }
    }
  }
  return { bright, dark };
}

function quantile(values, fraction) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

function percentile(values, fraction) {
  const histogram = new Uint32Array(256);
  for (let i = 0; i < values.length; i++) histogram[values[i]]++;
  const target = values.length * fraction;
  for (let level = 0, sum = 0; level < 256; level++) { sum += histogram[level]; if (sum >= target) return level; }
  return 255;
}

/** Everything the detectors share, computed once per raster. */
function* featuresOf(image) {
  const { data, width, height } = image, count = width * height;
  const { bright, dark } = yield* strokeContrast(image);
  const stroke = new Uint8Array(count);
  for (let i = 0; i < count; i++) stroke[i] = Math.max(bright[i], dark[i]);
  // Contrast the eye still reads as a stroke; relative to the picture's own
  // strongest strokes so a pastel cover and a black-and-white scan both work.
  const threshold = clamp(percentile(stroke, .985) * .4, 22, 60);
  // Light ink on a darker ground and dark ink on a lighter one are separate
  // maps: the gaps between light letters are dark strokes and must not count.
  const strokes = new Uint8Array(count), light = new Uint8Array(count), shade = new Uint8Array(count);
  let strokeCount = 0;
  for (let i = 0; i < count; i++) {
    if (bright[i] >= threshold) light[i] = 1;
    if (dark[i] >= threshold) shade[i] = 1;
    if (light[i] || shade[i]) { strokes[i] = 1; strokeCount++; }
  }
  const hue = new Float32Array(count), sat = new Float32Array(count), val = new Float32Array(count), gray = new Uint8Array(count);
  let busy = 0;
  for (let i = 0; i < count; i++) {
    const [h, s, v] = rgbToHsv(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
    hue[i] = h; sat[i] = s; val[i] = v;
    gray[i] = Math.round(data[i * 4] * .299 + data[i * 4 + 1] * .587 + data[i * 4 + 2] * .114);
    if (i % 3 === 0 && i > width && i % width > 0 && i % width < width - 1) {
      if (Math.abs(gray[i] - gray[i - 1]) + Math.abs(gray[i] - gray[i - width]) > 36) busy++;
    }
    if ((i & 16383) === 16383) yield;
  }
  busy = busy / Math.max(1, count / 3);
  return { width, height, count, stroke, strokes, light, shade, threshold, strokeFraction: strokeCount / count, hue, sat, val, gray, busy,
    photo: busy > .2 };
}

// ---- detectors (each returns { confidence, recipe, facts, mask } or null) ------------

const pct = value => `${Math.max(1, Math.round(value * 100))}%`;

function* detectLettering(image, feats) {
  const { width, height, strokes, stroke } = feats;
  const x0 = Math.round(width * .05), x1 = Math.round(width * .95), span = x1 - x0;
  const density = new Float32Array(height);
  for (let y = 0; y < height; y++) {
    let sum = 0;
    for (let x = x0; x < x1; x++) sum += strokes[y * width + x];
    density[y] = sum / span;
  }
  const smooth = new Float32Array(height);
  for (let y = 0; y < height; y++) {
    let sum = 0, n = 0;
    for (let j = Math.max(0, y - 1); j <= Math.min(height - 1, y + 1); j++) { sum += density[j]; n++; }
    smooth[y] = sum / n;
  }
  // A frame's rules are one-row spikes: judge the lines against the 95th
  // percentile of the rows, not the single densest one.
  const sorted = Array.from(smooth).sort((a, b) => a - b), peak = sorted[Math.floor(height * .95)];
  if (sorted[height - 1] < .04) return null;
  const level = Math.max(.035, peak * .16), gap = Math.max(2, Math.round(height * .02));
  const runs = [];
  for (let y = 0; y < height; y++) {
    if (smooth[y] < level) continue;
    let end = y;
    // Rows with a short dip (between two lines of one title) stay in one block.
    for (let next = y; next < height && next - end <= Math.max(1, Math.round(height * .012)); next++) if (smooth[next] >= level) end = next;
    runs.push([y, end]); y = end;
  }
  const bands = [];
  for (const [a, b] of runs) {
    const rows = b - a + 1;
    if (rows < Math.max(3, height * .012) || rows > height * .24) continue;
    let inside = 0;
    for (let y = a; y <= b; y++) inside += density[y];
    inside /= rows;
    let around = 0, aroundRows = 0;
    for (let y = Math.max(0, a - gap); y < a; y++) { around += density[y]; aroundRows++; }
    for (let y = b + 1; y <= Math.min(height - 1, b + gap); y++) { around += density[y]; aroundRows++; }
    if (aroundRows && around / aroundRows > inside * .5) continue;
    // The line's ink is whichever polarity (light on dark, dark on light) dominates.
    let lightInk = 0, shadeInk = 0;
    for (let y = a; y <= b; y++) for (let x = x0; x < x1; x++) { lightInk += feats.light[y * width + x]; shadeInk += feats.shade[y * width + x]; }
    const polarity = lightInk >= shadeInk ? 'light' : 'shade', inkMap = feats[polarity];
    // Letters are separated clusters along the line, not one continuous bar.
    const columns = new Uint8Array(width);
    let ink = 0, contrast = 0, inked = 0;
    for (let y = a; y <= b; y++) for (let x = x0; x < x1; x++) {
      const at = y * width + x;
      if (inkMap[at]) { columns[x] = 1; ink++; contrast += stroke[at]; }
    }
    let segments = 0, left = -1, right = -1, previous = 0;
    for (let x = 0; x < width; x++) {
      if (columns[x]) { if (!previous) segments++; if (left < 0) left = x; right = x; }
      previous = columns[x]; inked += columns[x];
    }
    const fill = ink / (rows * Math.max(1, right - left + 1));
    const widthFraction = (right - left + 1) / width;
    if (segments < 4 || widthFraction < .16 || fill < .05 || fill > .85) continue;
    bands.push({ y0: a, y1: b, x0: left, x1: right, segments, fill, polarity, contrast: contrast / Math.max(1, ink) });
    yield;
  }
  if (!bands.length) return null;
  bands.sort((p, q) => p.y0 - q.y0);
  const used = bands.slice(0, 6);
  const heights = used.reduce((sum, band) => sum + (band.y1 - band.y0 + 1), 0) / height;
  const textiness = used.reduce((sum, band) => sum + Math.min(1, band.segments / 10), 0) / used.length;
  const contrast = used.reduce((sum, band) => sum + band.contrast, 0) / used.length;
  let confidence = .3 + .22 * Math.min(1, used.length / 2) + .22 * textiness + .18 * Math.min(1, contrast / 70) + .08 * (heights < .3 ? 1 : .4);
  if (feats.photo) confidence *= .82;
  const recipe = { kind: 'lettering', threshold: feats.threshold,
    bands: used.map(band => ({ y0: band.y0 / height, y1: (band.y1 + 1) / height, x0: band.x0 / width, x1: (band.x1 + 1) / width, polarity: band.polarity })) };
  return { id: 'lettering', confidence: clamp(confidence, 0, .97), recipe, facts: { lines: used.length, share: heights } };
}

const METALS = Object.freeze({
  gold: (h, s, v) => h >= 32 && h <= 58 && s >= .35 && v >= .45,
  bronze: (h, s, v) => h >= 14 && h < 32 && s >= .35 && v >= .35 && v <= .92,
  silver: (h, s, v) => s <= .14 && v >= .62 && v <= .97
});

/** Metallic-looking inks: hue/saturation/brightness windows, kept only where
 * the shape is compact or strokelike and clearly stands out from what
 * surrounds it (a gold or white cover itself is not ink). */
function* metalMask(image) {
  const { data, width, height } = image, count = width * height;
  const classes = new Uint8Array(count), mask = new Uint8Array(count);
  const value = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const [h, s, v] = rgbToHsv(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
    value[i] = v;
    if (METALS.gold(h, s, v)) classes[i] = 1; else if (METALS.bronze(h, s, v)) classes[i] = 2; else if (METALS.silver(h, s, v)) classes[i] = 3;
    if (classes[i]) mask[i] = 1;
    if ((i & 16383) === 16383) yield;
  }
  // A class that fills a third of the cover is the paper or the cloth, not ink.
  const share = [0, 0, 0, 0];
  for (let i = 0; i < count; i++) share[classes[i]]++;
  for (let kind = 1; kind <= 3; kind++) if (share[kind] > count * .3) for (let i = 0; i < count; i++) if (classes[i] === kind) { classes[i] = 0; mask[i] = 0; }
  const { labels, list } = yield* components(mask, width, height);
  const keep = new Uint8Array(list.length + 1), area = { gold: 0, bronze: 0, silver: 0 };
  let kept = 0, contrastSum = 0, keptArea = 0;
  const minArea = Math.max(3, count * .00018);
  const names = ['', 'gold', 'bronze', 'silver'];
  for (const component of list) {
    yield;
    if (component.area < minArea || component.area > count * .2) continue;
    const boxWidth = component.x1 - component.x0 + 1, boxHeight = component.y1 - component.y0 + 1;
    if (boxWidth > width * .85 && boxHeight > height * .85) continue;
    const pad = 3, ax = Math.max(0, component.x0 - pad), bx = Math.min(width - 1, component.x1 + pad);
    const ay = Math.max(0, component.y0 - pad), by = Math.min(height - 1, component.y1 + pad);
    let around = 0, aroundCount = 0, inside = 0, insideCount = 0, kind = 0;
    for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) {
      const at = y * width + x;
      if (labels[at] === component.id) { inside += value[at]; insideCount++; kind = classes[at]; }
      else if (!mask[at]) { around += value[at]; aroundCount++; }
    }
    if (!aroundCount) continue;
    const surround = around / aroundCount, own = inside / insideCount, delta = Math.abs(own - surround);
    // A light "silver" ink only reads as foil against a dark field.
    if (kind === 3 && !(surround < .42 && own > surround + .28)) continue;
    if (kind !== 3 && delta < .14) continue;
    keep[component.id] = 1; kept++; keptArea += component.area; contrastSum += delta;
    const bucket = names[kind]; if (bucket) area[bucket] += component.area;
  }
  const out = new Uint8Array(count);
  for (let i = 0; i < count; i++) if (labels[i] && keep[labels[i]]) out[i] = 1;
  return { mask: out, kept, area, coverage: keptArea / count, contrast: kept ? contrastSum / kept : 0 };
}

function* detectFoil(image, feats) {
  const found = yield* metalMask(image);
  if (!(found.coverage >= .003 && (found.kept >= 3 || found.coverage >= .02))) return null;
  const total = found.area.gold + found.area.bronze + found.area.silver || 1;
  let metal = 'gold';
  for (const name of ['bronze', 'silver']) if (found.area[name] > found.area[metal]) metal = name;
  // Anti-aliased gold on a dark ground blends through orange: favour gold.
  if (metal === 'bronze' && found.area.gold >= found.area.bronze * .5) metal = 'gold';
  let confidence = .34 + .3 * Math.min(1, found.coverage / .03) + .2 * Math.min(1, found.kept / 12) + .16 * Math.min(1, found.contrast / .45);
  if (found.area[metal] / total < .55) confidence -= .06;
  if (feats.photo) confidence *= .8;
  return { id: 'foil', confidence: clamp(confidence, 0, .97), recipe: { kind: 'foil' }, facts: { metal, coverage: found.coverage }, mask: found.mask };
}

function* detectFrame(image, feats) {
  const { width, height, strokes } = feats, short = Math.min(width, height);
  const half = Math.max(1, Math.round(short * .012)), corner = Math.round(short * .06);
  const from = Math.max(3, Math.round(short * .015)), to = Math.round(short * .16);
  const scores = [];
  const covered = (x, y, horizontal) => {
    for (let d = -half; d <= half; d++) {
      const px = horizontal ? x : x + d, py = horizontal ? y + d : y;
      if (px >= 0 && px < width && py >= 0 && py < height && strokes[py * width + px]) return true;
    }
    return false;
  };
  for (let k = from; k <= to; k++) {
    const x0 = k, x1 = width - 1 - k, y0 = k, y1 = height - 1 - k;
    if (x1 - x0 < short * .4 || y1 - y0 < short * .4) break;
    const side = [0, 0, 0, 0], total = [0, 0, 0, 0];
    for (let x = x0 + corner; x <= x1 - corner; x++) {
      total[0]++; total[1]++;
      if (covered(x, y0, true)) side[0]++;
      if (covered(x, y1, true)) side[1]++;
    }
    for (let y = y0 + corner; y <= y1 - corner; y++) {
      total[2]++; total[3]++;
      if (covered(x0, y, false)) side[2]++;
      if (covered(x1, y, false)) side[3]++;
    }
    const cover = side.map((value, i) => value / Math.max(1, total[i])).sort((a, b) => a - b);
    scores.push({ k, score: (cover[1] + cover[2] + cover[3]) / 3, weakest: cover[0] });
    yield;
  }
  if (!scores.length) return null;
  const best = scores.reduce((a, b) => (b.score > a.score ? b : a));
  const median = scores.map(item => item.score).sort((a, b) => a - b)[scores.length >> 1];
  const ridge = best.score - median;
  if (best.score < .8 || ridge < .4 || best.weakest < .35) return null;
  let confidence = .38 + .28 * smoothstep(.8, 1, best.score) + .22 * smoothstep(.4, .9, ridge) + .1 * smoothstep(.35, .9, best.weakest);
  if (feats.photo) confidence *= .75;
  const recipe = { kind: 'frame', inset: best.k / short, half: half * 2.4 / short, threshold: feats.threshold };
  return { id: 'frame', confidence: clamp(confidence, 0, .97), recipe, facts: { inset: best.k / short, full: best.weakest > .7 } };
}

/** Pixels that differ from the colour at the left/right margin of their own
 * row (so a vertical gradient is background, not subject), thin strokes
 * opened away, then the most central compact blob. */
function* detectSubject(image, feats, frameInset) {
  const { data, width, height } = image, count = width * height;
  const margin = Math.max(2, Math.round(width * .04)), background = new Float32Array(height * 3);
  const samples = [new Uint8Array(margin * 2), new Uint8Array(margin * 2), new Uint8Array(margin * 2)];
  for (let y = 0; y < height; y++) {
    for (let channel = 0; channel < 3; channel++) {
      let n = 0;
      for (let x = 0; x < margin; x++) { samples[channel][n++] = data[(y * width + x) * 4 + channel]; samples[channel][n++] = data[(y * width + width - 1 - x) * 4 + channel]; }
      const sorted = Array.from(samples[channel]).sort((a, b) => a - b);
      background[y * 3 + channel] = sorted[sorted.length >> 1];
    }
  }
  // Smooth the per-row estimate so one bright row of a frame does not matter.
  const smoothBg = new Float32Array(height * 3);
  for (let y = 0; y < height; y++) for (let c = 0; c < 3; c++) {
    let sum = 0, n = 0;
    for (let j = Math.max(0, y - 3); j <= Math.min(height - 1, y + 3); j++) { sum += background[j * 3 + c]; n++; }
    smoothBg[y * 3 + c] = sum / n;
  }
  const distance = new Uint8Array(count), histogram = new Uint32Array(256);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = y * width + x, dr = data[at * 4] - smoothBg[y * 3], dg = data[at * 4 + 1] - smoothBg[y * 3 + 1], db = data[at * 4 + 2] - smoothBg[y * 3 + 2];
      const value = Math.min(255, Math.round(Math.sqrt(2 * dr * dr + 4 * dg * dg + 3 * db * db) / 3));
      distance[at] = value; histogram[value]++;
    }
    if ((y & 15) === 15) yield;
  }
  // Otsu: where the picture splits into "like the margin" and "unlike it".
  let sumAll = 0;
  for (let i = 0; i < 256; i++) sumAll += i * histogram[i];
  let weightB = 0, sumB = 0, bestVariance = -1, otsu = 40;
  for (let t = 0; t < 256; t++) {
    weightB += histogram[t]; if (!weightB) continue;
    const weightF = count - weightB; if (!weightF) break;
    sumB += t * histogram[t];
    const meanB = sumB / weightB, meanF = (sumAll - sumB) / weightF;
    const variance = weightB * weightF * (meanB - meanF) ** 2;
    if (variance > bestVariance) { bestVariance = variance; otsu = t; }
  }
  const threshold = clamp(otsu, 36, 110);
  const inset = Math.max(frameInset ? Math.round((frameInset + .03) * Math.min(width, height)) : 0, Math.round(Math.min(width, height) * .03));
  const salient = new Uint8Array(count);
  for (let y = inset; y < height - inset; y++) for (let x = inset; x < width - inset; x++) {
    const at = y * width + x;
    if (distance[at] >= threshold) salient[at] = 1;
  }
  const long = Math.max(width, height);
  const solid = yield* openMask(salient, width, height, Math.max(2, Math.round(long * .022)));
  const { labels, list } = yield* components(solid, width, height);
  let best = null;
  for (const component of list) {
    const frac = component.area / count, boxW = component.x1 - component.x0 + 1, boxH = component.y1 - component.y0 + 1;
    if (frac < .012 || frac > .62) continue;
    if (boxW > width * .94 && boxH > height * .94) continue;
    const dx = (component.cx / width - .5) * 2, dy = (component.cy / height - .5) * 2;
    const centrality = 1 - Math.min(1, Math.hypot(dx, dy * .8) / 1.15);
    const solidity = component.area / (boxW * boxH);
    // Full-width runs are the band detector's business; a motif must be central.
    if (boxW >= width * .68 && boxW / boxH >= 2.2 || centrality < .4) continue;
    const score = Math.sqrt(frac) * centrality * (.5 + solidity);
    if (!best || score > best.score) best = { component, frac, centrality, solidity, score };
  }
  if (!best) return null;
  const mask = new Uint8Array(count), id = best.component.id;
  for (let i = 0; i < count; i++) if (labels[i] === id) mask[i] = 1;
  const filled = yield* closeMask(mask, width, height, Math.max(1, Math.round(long * .01)));
  let confidence = .3 + .3 * best.centrality + .2 * best.solidity + .16 * smoothstep(.015, .16, best.frac);
  if (feats.photo) confidence *= .6;
  return { id: 'emblem', confidence: clamp(confidence, 0, .95), recipe: { kind: 'emblem', blob: true },
    facts: { share: best.frac, subject: best.frac > .16, centred: best.centrality }, mask: filled };
}

/** A flat horizontal band of one colour that crosses the cover and differs
 * from the cover's main colour (a title strip, a publisher's block). */
function* detectBand(image, feats) {
  const { data, width, height } = image, count = width * height;
  const bins = new Uint16Array(4096), overall = new Uint32Array(4096);
  const x0 = Math.round(width * .1), x1 = Math.round(width * .9), span = x1 - x0;
  const rows = [];
  for (let y = 0; y < height; y++) {
    bins.fill(0);
    let best = 0, bestBin = 0;
    for (let x = x0; x < x1; x++) {
      const at = (y * width + x) * 4, bin = (data[at] >> 4) << 8 | (data[at + 1] >> 4) << 4 | data[at + 2] >> 4;
      overall[bin]++;
      if (++bins[bin] > best) { best = bins[bin]; bestBin = bin; }
    }
    rows.push({ bin: bestBin, share: best / span });
    if ((y & 15) === 15) yield;
  }
  let mainBin = 0;
  for (let i = 1; i < 4096; i++) if (overall[i] > overall[mainBin]) mainBin = i;
  const colour = bin => [(bin >> 8) * 16 + 8, ((bin >> 4) & 15) * 16 + 8, (bin & 15) * 16 + 8];
  const apart = (a, b) => Math.hypot(...colour(a).map((v, i) => v - colour(b)[i]));
  const runs = [];
  for (let y = 0; y < height; y++) {
    if (rows[y].share < .6) continue;
    let end = y;
    while (end + 1 < height && rows[end + 1].share >= .6 && apart(rows[end + 1].bin, rows[y].bin) < 30) end++;
    runs.push({ a: y, b: end, bin: rows[y].bin }); y = end;
  }
  // Lettering on the band breaks its rows' flatness: rejoin runs of one colour.
  const merged = [];
  for (const run of runs) {
    const last = merged[merged.length - 1];
    if (last && run.a - last.b <= height * .12 && apart(last.bin, run.bin) < 30) last.b = run.b; else merged.push({ ...run });
  }
  let best = null;
  for (const run of merged) {
    const rowsHigh = run.b - run.a + 1, tall = rowsHigh / height;
    if (tall < .05 || tall > .45 || run.a < height * .03 || run.b > height * .97) continue;
    const different = apart(run.bin, mainBin);
    if (different < 55) continue;
    // A band has an edge at both ends; a gradient or a text row does not.
    const above = rows[Math.max(0, run.a - 3)], below = rows[Math.min(height - 1, run.b + 3)];
    if (above.share < .6 || below.share < .6 || apart(above.bin, run.bin) < 45 || apart(below.bin, run.bin) < 45) continue;
    const shares = rows.slice(run.a, run.b + 1).map(row => row.share).sort((p, q) => p - q), share = shares[shares.length >> 1];
    if (share < .85) continue;
    const score = different / 255 + tall;
    if (!best || score > best.score) best = { ...run, tall, share, different, score };
  }
  if (!best) return null;
  const mask = new Uint8Array(count);
  for (let y = best.a; y <= best.b; y++) mask.fill(1, y * width, (y + 1) * width);
  let confidence = .42 + .24 * smoothstep(.05, .2, best.tall) + .18 * smoothstep(55, 160, best.different) + .12 * smoothstep(.6, .95, best.share);
  if (feats.photo) confidence *= .6;
  return { id: 'band', confidence: clamp(confidence, 0, .95), recipe: { kind: 'band', blob: true }, facts: { share: best.tall, from: best.a / height, to: (best.b + 1) / height }, mask };
}

function* detectVarnish(image, feats) {
  const { width, height, count, gray, val, strokes } = feats;
  const flat = new Uint8Array(count);
  let flatCount = 0;
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    const at = y * width + x;
    if (val[at] >= .3 || strokes[at]) continue;
    const gradient = Math.abs(gray[at + 1] - gray[at - 1]) + Math.abs(gray[at + width] - gray[at - width]);
    if (gradient < 14) { flat[at] = 1; flatCount++; }
    if ((at & 8191) === 0) yield;
  }
  if (flatCount < count * .1) return null;
  const opened = yield* openMask(flat, width, height, 2);
  const { labels, list } = yield* components(opened, width, height);
  let total = 0;
  const keep = new Uint8Array(list.length + 1);
  for (const component of list) if (component.area >= count * .06) { keep[component.id] = 1; total += component.area; }
  const share = total / count;
  if (share < .1 || share > .94) return null;
  const mask = new Uint8Array(count);
  for (let i = 0; i < count; i++) if (labels[i] && keep[labels[i]]) mask[i] = 1;
  let confidence = .3 + .3 * smoothstep(.1, .5, share) + .14 * (1 - feats.busy * 3 > 0 ? 1 - feats.busy * 3 : 0) + .1;
  if (feats.photo) confidence *= .7;
  return { id: 'varnish', confidence: clamp(confidence, 0, .9), recipe: { kind: 'varnish', blob: true }, facts: { share }, mask };
}

// ---- masks for a recipe at any raster size ---------------------------------------

function* roundedRect(width, height, x0, y0, x1, y1, radius) {
  const mask = new Uint8Array(width * height), r = radius * Math.min(width, height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const px = x / width, py = y / height;
    if (px < x0 || px > x1 || py < y0 || py > y1) continue;
    const cx = Math.min(x - x0 * width, x1 * width - x), cy = Math.min(y - y0 * height, y1 * height - y);
    if (cx < r && cy < r && Math.hypot(r - cx, r - cy) > r) continue;
    mask[y * width + x] = 1;
    if ((x === width - 1) && (y & 15) === 15) yield;
  }
  return mask;
}

function* suggestedFrame(width, height, inset = .05, thickness = .012) {
  const outer = yield* roundedRect(width, height, inset, inset * width / height, 1 - inset, 1 - inset * width / height, .012);
  const t = Math.max(1.5, thickness * Math.min(width, height));
  const innerX = (inset * width + t) / width, innerY = (inset * width + t) / height;
  const inner = yield* roundedRect(width, height, innerX, innerY, 1 - innerX, 1 - innerY, .006);
  const ring = new Uint8Array(width * height);
  for (let i = 0; i < ring.length; i++) { ring[i] = outer[i] && !inner[i] ? 1 : 0; if ((i & 32767) === 32767) yield; }
  return ring;
}

function* upsample(workMask, workWidth, workHeight, width, height) {
  const out = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    const fy = clamp((y + .5) / height * workHeight - .5, 0, workHeight - 1), y0 = Math.floor(fy), y1 = Math.min(workHeight - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < width; x++) {
      const fx = clamp((x + .5) / width * workWidth - .5, 0, workWidth - 1), x0 = Math.floor(fx), x1 = Math.min(workWidth - 1, x0 + 1), tx = fx - x0;
      const top = workMask[y0 * workWidth + x0] * (1 - tx) + workMask[y0 * workWidth + x1] * tx;
      const bottom = workMask[y1 * workWidth + x0] * (1 - tx) + workMask[y1 * workWidth + x1] * tx;
      out[y * width + x] = smoothstep(.3, .7, top * (1 - ty) + bottom * ty);
    }
    if ((y & 31) === 31) yield;
  }
  return out;
}

/** The binary mask (0/1, `image` resolution) of a recipe on a raster. */
function* recipeMask(image, recipe, feats = null) {
  const { width, height } = image;
  if (recipe.kind === 'lettering') {
    const f = feats ?? (yield* featuresOf(image));
    const out = new Uint8Array(width * height);
    const pad = Math.max(1, Math.round(height * .008));
    for (const band of recipe.bands) {
      const y0 = Math.max(0, Math.floor(band.y0 * height) - pad), y1 = Math.min(height - 1, Math.ceil(band.y1 * height) + pad);
      const x0 = Math.max(0, Math.floor(band.x0 * width) - pad), x1 = Math.min(width - 1, Math.ceil(band.x1 * width) + pad);
      const ink = f[band.polarity] ?? f.strokes;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (ink[y * width + x]) out[y * width + x] = 1;
    }
    return yield* closeMask(out, width, height, 1);
  }
  if (recipe.kind === 'foil') return (yield* metalMask(image)).mask;
  if (recipe.kind === 'frame') {
    const f = feats ?? (yield* featuresOf(image)), short = Math.min(width, height);
    const k = recipe.inset * short, half = Math.max(2, recipe.half * short);
    const inBand = (x, y) => {
      const dx = Math.min(x, width - 1 - x), dy = Math.min(y, height - 1 - y);
      return Math.abs(Math.min(dx, dy) - k) <= half && Math.min(dx, dy) >= k - half;
    };
    const seed = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (f.strokes[y * width + x] && inBand(x, y)) seed[y * width + x] = 1;
    const { labels, list } = yield* components(f.strokes, width, height);
    const touches = new Uint8Array(list.length + 1);
    for (let i = 0; i < seed.length; i++) if (seed[i]) touches[labels[i]] = 1;
    const out = new Uint8Array(width * height);
    for (let i = 0; i < out.length; i++) {
      const label = labels[i];
      if (label && touches[label] && list[label - 1].area < width * height * .15) out[i] = 1;
    }
    return yield* closeMask(out, width, height, 1);
  }
  return null;
}

// ---- maps ---------------------------------------------------------------------------

/** Chamfer distance (in pixels) from every pixel to the nearest outside pixel. */
function* insideDistance(mask, width, height) {
  const big = 1e6, d = new Float32Array(width * height);
  for (let i = 0; i < d.length; i++) d[i] = mask[i] ? big : 0;
  const a = 1, b = 1.4142;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = y * width + x;
      if (!d[at]) continue;
      let v = d[at];
      if (x > 0) v = Math.min(v, d[at - 1] + a);
      if (y > 0) {
        v = Math.min(v, d[at - width] + a);
        if (x > 0) v = Math.min(v, d[at - width - 1] + b);
        if (x < width - 1) v = Math.min(v, d[at - width + 1] + b);
      }
      d[at] = v;
    }
    if ((y & 15) === 15) yield;
  }
  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      const at = y * width + x;
      if (!d[at]) continue;
      let v = d[at];
      if (x < width - 1) v = Math.min(v, d[at + 1] + a);
      if (y < height - 1) {
        v = Math.min(v, d[at + width] + a);
        if (x < width - 1) v = Math.min(v, d[at + width + 1] + b);
        if (x > 0) v = Math.min(v, d[at + width - 1] + b);
      }
      d[at] = v;
    }
    if ((y & 15) === 15) yield;
  }
  return d;
}

function* boxBlur(field, width, height, radius) {
  if (radius < 1) return field;
  const middle = new Float32Array(field.length), out = new Float32Array(field.length), size = radius * 2 + 1;
  for (let y = 0; y < height; y++) {
    let sum = 0;
    for (let x = -radius; x <= radius; x++) sum += field[y * width + clamp(x, 0, width - 1)];
    for (let x = 0; x < width; x++) {
      middle[y * width + x] = sum / size;
      sum += field[y * width + clamp(x + radius + 1, 0, width - 1)] - field[y * width + clamp(x - radius, 0, width - 1)];
    }
    if ((y & 15) === 15) yield;
  }
  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let y = -radius; y <= radius; y++) sum += middle[clamp(y, 0, height - 1) * width + x];
    for (let y = 0; y < height; y++) {
      out[y * width + x] = sum / size;
      sum += middle[clamp(y + radius + 1, 0, height - 1) * width + x] - middle[clamp(y - radius, 0, height - 1) * width + x];
    }
    if ((x & 31) === 31) yield;
  }
  return out;
}

function* grainField(width, height, seed) {
  // Pebbled grain: ridged value noise at two scales, like a leather or
  // buckram embossing plate. Fixed by the cover's seed.
  const out = new Float32Array(width * height), cell = Math.max(2.4, Math.min(width, height) / 90);
  const octave = (x, y, size, salt) => {
    const gx = x / size, gy = y / size, ix = Math.floor(gx), iy = Math.floor(gy), fx = gx - ix, fy = gy - iy;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const v = (a, b) => hash2(ix + a, iy + b, seed + salt);
    return (v(0, 0) * (1 - sx) + v(1, 0) * sx) * (1 - sy) + (v(0, 1) * (1 - sx) + v(1, 1) * sx) * sy;
  };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const n = octave(x, y, cell, 11) * .65 + octave(x, y, cell * 2.6, 23) * .35;
    out[y * width + x] = 1 - Math.abs(n * 2 - 1);
    if (x === width - 1 && (y & 7) === 7) yield;
  }
  return out;
}

const toByte = value => Math.round(clamp(value, 0, 1) * 255);

/** The three maps (height in MAX_RELIEF_MM units, foil, gloss; bytes) for a
 * detected or suggested family, at `width` x `height`. `mask` is the
 * detector's mask at its own raster, `workSize` that raster's dimensions. */
function* mapsFor(id, selection, width, height, seed) {
  const family = FAMILIES[id], count = width * height;
  let mask = selection.mask01, field = null, bevel = Math.max(1.4, Math.max(width, height) * .006), glossShare = 0;
  if (id === 'lettering') { bevel = Math.max(1.2, Math.max(width, height) * .0045); glossShare = .9; }
  else if (id === 'foil') { bevel = Math.max(1.2, Math.max(width, height) * .0045); }
  else if (id === 'frame') { bevel = Math.max(1.2, Math.max(width, height) * .005); glossShare = .5; }
  else if (id === 'emblem') { bevel = Math.max(3, Math.max(width, height) * .028); glossShare = 1; }
  else if (id === 'band') { bevel = Math.max(2.5, Math.max(width, height) * .016); glossShare = .8; }
  else if (id === 'varnish') { bevel = Math.max(1.2, Math.max(width, height) * .004); glossShare = 1; }
  else if (id === 'panel') { bevel = Math.max(3, Math.max(width, height) * .02); }
  const out = { width, height, heightMap: new Uint8Array(count), foil: new Uint8Array(count), gloss: new Uint8Array(count) };
  if (id === 'grain') {
    out.soft = true;
    field = yield* grainField(width, height, seed);
    for (let i = 0; i < count; i++) { out.heightMap[i] = toByte(field[i] * family.mm / MAX_RELIEF_MM); if ((i & 32767) === 32767) yield; }
    return out;
  }
  const hard = new Uint8Array(count);
  for (let i = 0; i < count; i++) hard[i] = mask[i] > .5 ? 1 : 0;
  yield;
  const distance = yield* insideDistance(hard, width, height);
  const profile = new Float32Array(count);
  for (let i = 0; i < count; i++) { profile[i] = distance[i] ? smoothstep(0, bevel, distance[i] - .5) : 0; if ((i & 32767) === 32767) yield; }
  const softened = yield* boxBlur(profile, width, height, 1);
  const soft = yield* boxBlur(mask, width, height, 1);
  for (let i = 0; i < count; i++) {
    out.heightMap[i] = toByte(softened[i] * family.mm / MAX_RELIEF_MM);
    if (id === 'foil') out.foil[i] = toByte(soft[i]);
    if (glossShare) out.gloss[i] = toByte(soft[i] * glossShare);
    if ((i & 32767) === 32767) yield;
  }
  return out;
}

// ---- proposals ----------------------------------------------------------------------

const METAL_NAMES = { gold: 'dorada', bronze: 'cobriza', silver: 'plateada' };

function describe(candidate) {
  const f = candidate.facts ?? {};
  switch (candidate.id) {
    case 'lettering': return { label: 'Letras en relieve',
      description: f.lines > 1 ? `Las ${f.lines} líneas de texto de la portada, elevadas con barniz brillante` : 'La línea de texto de la portada, elevada con barniz brillante' };
    case 'foil': return f.metal === 'silver'
      ? { label: 'Tinta clara en foil plateado', description: `Tinta clara sobre fondo oscuro (${pct(f.coverage)} de la portada), sellada como foil plateado en relieve` }
      : { label: `Tinta ${METAL_NAMES[f.metal] ?? 'metálica'} en relieve`,
        description: `Tinta ${METAL_NAMES[f.metal] ?? 'metálica'} (${pct(f.coverage)} de la portada) sellada como foil metálico en relieve` };
    case 'frame': return candidate.detected
      ? { label: 'Marco en relieve', description: `El marco que rodea la portada, elevado${f.full ? ' en sus cuatro lados' : ''}` }
      : { label: 'Marco en relieve', description: 'Sugerencia: un marco sellado cerca del borde (no se ha detectado ninguno)' };
    case 'emblem': return f.subject
      ? { label: 'Motivo principal', description: `La figura principal (${pct(f.share)} de la portada), en relieve suave con barniz` }
      : { label: 'Motivo central', description: `El motivo destacado del centro (${pct(f.share)} de la portada), elevado con barniz` };
    case 'band': return { label: 'Franja en relieve', description: `La franja horizontal de color (${pct(f.share)} del alto de la portada), elevada como una placa` };
    case 'varnish': return { label: 'Barniz sobre fondo oscuro', description: `La gran zona oscura y lisa (${pct(f.share)} de la portada), con barniz selectivo brillante` };
    case 'grain': return { label: 'Textura de piel', description: 'Sugerencia: grano fino de piel sobre toda la portada' };
    default: return { label: 'Recuadro central', description: 'Sugerencia: un recuadro en relieve suave en el centro de la portada' };
  }
}

/** A fallback needs no detection: its mask is geometry or noise. */
function* suggestion(id, work) {
  if (id === 'grain') return { id, confidence: .22, recipe: { kind: 'grain' }, detected: false, facts: {} };
  if (id === 'panel') return { id, confidence: .18, recipe: { kind: 'panel' }, detected: false, facts: {} };
  return { id: 'frame', confidence: .2, recipe: { kind: 'frame', suggested: true }, detected: false, facts: {}, mask: yield* suggestedFrame(work.width, work.height) };
}

function overlap(a, b) {
  if (!a || !b) return 0;
  let both = 0, areaA = 0, areaB = 0;
  for (let i = 0; i < a.length; i++) { areaA += a[i]; areaB += b[i]; both += a[i] & b[i]; }
  return both / Math.max(1, Math.min(areaA, areaB));
}

/** Pure analysis on RGBA pixels: every candidate found, ranked, and the three
 * proposals chosen. Always exactly three, always the same for the same pixels. */
export function* analyzePixels(image) {
  const feats = yield* featuresOf(image);
  const detectors = [
    ['foil', detectFoil], ['lettering', detectLettering], ['frame', detectFrame], ['band', detectBand]
  ];
  const candidates = [];
  for (const [, detect] of detectors) {
    const found = yield* detect(image, feats);
    if (found) candidates.push({ ...found, detected: true });
  }
  const frame = candidates.find(item => item.id === 'frame');
  const subject = yield* detectSubject(image, feats, frame?.recipe.inset);
  if (subject) candidates.push({ ...subject, detected: true });
  const varnish = yield* detectVarnish(image, feats);
  if (varnish) candidates.push({ ...varnish, detected: true });
  // Masks the detector did not keep (stroke families) are built from the recipe
  // here, so the overlap test can compare any two candidates.
  for (const candidate of candidates) if (!candidate.mask) candidate.mask = yield* recipeMask(image, candidate.recipe, feats);
  const order = candidate => FAMILIES[candidate.id].order;
  const strong = candidates.filter(item => item.confidence >= CONFIDENT).sort((a, b) => b.confidence - a.confidence || order(a) - order(b));
  const chosen = [];
  for (const candidate of strong) {
    if (chosen.length === 3) break;
    if (chosen.some(other => other.id === candidate.id || overlap(other.mask, candidate.mask) > .5)) continue;
    chosen.push(candidate);
  }
  // Weakly supported detections still beat an invented suggestion.
  const weak = candidates.filter(item => item.confidence < CONFIDENT && item.confidence >= .22)
    .sort((a, b) => b.confidence - a.confidence || order(a) - order(b));
  for (const candidate of weak) {
    if (chosen.length === 3) break;
    if (!chosen.some(other => other.id === candidate.id || overlap(other.mask, candidate.mask) > .5)) chosen.push(candidate);
  }
  // Suggestions: always available, so there are always three.
  const taken = new Set(chosen.map(item => item.id));
  const fallbacks = feats.photo ? ['grain', 'frame', 'panel'] : ['frame', 'grain', 'panel'];
  for (const id of fallbacks) {
    if (chosen.length === 3) break;
    if (taken.has(id)) continue;
    chosen.push(yield* suggestion(id, image)); taken.add(id);
  }
  chosen.sort((a, b) => b.confidence - a.confidence || order(a) - order(b));
  const seed = seedOf(image);
  return { feats, chosen, candidates, seed };
}

/** Build the maps for one proposal. `hires` is the cover at map resolution
 * (stroke families are recomputed there so the edges stay crisp); blob and
 * suggested families are scaled up from the working mask. */
export function* buildMapsFromPixels(work, hires, selection, seed) {
  const { id } = selection, width = hires.width, height = hires.height;
  let mask01;
  const kind = selection.recipe.kind;
  if (kind === 'lettering' || kind === 'foil' || kind === 'frame' && !selection.recipe.suggested) {
    const mask = yield* recipeMask(hires, selection.recipe);
    mask01 = new Float32Array(mask.length);
    for (let i = 0; i < mask.length; i++) mask01[i] = mask[i];
  } else if (kind === 'frame') {
    const mask = yield* suggestedFrame(width, height);
    mask01 = new Float32Array(mask.length);
    for (let i = 0; i < mask.length; i++) mask01[i] = mask[i];
  } else if (kind === 'panel') {
    const mask = yield* roundedRect(width, height, .15, .2, .85, .8, .03);
    mask01 = new Float32Array(mask.length);
    for (let i = 0; i < mask.length; i++) mask01[i] = mask[i];
  } else if (kind === 'grain') mask01 = new Float32Array(width * height);
  else mask01 = yield* upsample(selection.mask, work.width, work.height, width, height);
  const maps = yield* mapsFor(id, { mask01 }, width, height, seed);
  maps.foilColor = id === 'foil' ? sampleInk(hires, maps.foil) : null;
  return maps;
}

function sampleInk(image, foil) {
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < foil.length; i++) if (foil[i] > 200) { r += image.data[i * 4]; g += image.data[i * 4 + 1]; b += image.data[i * 4 + 2]; n++; }
  return n ? [Math.round(r / n), Math.round(g / n), Math.round(b / n)] : null;
}

// ---- shading: the preview card and the material maps ----------------------------------

const MM_FULL_COVER = 200; // a cover is about 20 cm tall

/** Tangent-space normals (RGBA bytes) from the height map; +x right, +y up the cover. */
export function* heightToNormals(maps, { gain = 1 } = {}) {
  const { width, height, heightMap } = maps;
  const out = new Uint8ClampedArray(width * height * 4);
  const mmPerPixel = MM_FULL_COVER / Math.max(width, height), unit = MAX_RELIEF_MM / 255 / (2 * mmPerPixel) * gain;
  const at = (x, y) => heightMap[clamp(y, 0, height - 1) * width + clamp(x, 0, width - 1)];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const nx = -(at(x + 1, y) - at(x - 1, y)) * unit, ny = (at(x, y + 1) - at(x, y - 1)) * unit;
      const length = Math.hypot(nx, ny, 1), i = (y * width + x) * 4;
      out[i] = (nx / length * .5 + .5) * 255; out[i + 1] = (ny / length * .5 + .5) * 255; out[i + 2] = (1 / length * .5 + .5) * 255; out[i + 3] = 255;
    }
    if ((y & 15) === 15) yield;
  }
  return out;
}

/** The packed material map: R clearcoat share, G roughness multiplier, B
 * metalness. `finish` carries the cover's own laminate so the zones that are
 * not varnished keep it exactly; gloss zones reach a full clearcoat even on a
 * matte cover, and foil drops to a polished metal roughness. */
export function* composeMaterialMap(maps, { clearcoat = 0, roughness = .5 } = {}) {
  const { width, height, foil, gloss } = maps, out = new Uint8ClampedArray(width * height * 4);
  const base = clamp(clearcoat, 0, 1), foilRoughness = clamp(.3 / Math.max(.05, roughness), .2, 1);
  for (let i = 0; i < width * height; i++) {
    const f = foil[i] / 255, g = gloss[i] / 255;
    out[i * 4] = (base + (1 - base) * g) * 255;
    out[i * 4 + 1] = (1 - f * (1 - foilRoughness)) * 255;
    out[i * 4 + 2] = f * 255;
    out[i * 4 + 3] = 255;
    if ((i & 32767) === 32767) yield;
  }
  return out;
}

/** Shaded preview, lit from the top-left, as RGBA bytes (pure; the browser
 * wrapper only turns it into a data URL). Foil zones glint, gloss zones shine. */
export function* shadePreview(image, maps, { slope = 7 } = {}) {
  const { width, height, data } = image, out = new Uint8ClampedArray(width * height * 4);
  const light = [-.52, .58, .63], lightLength = Math.hypot(...light);
  light[0] /= lightLength; light[1] /= lightLength; light[2] /= lightLength;
  const half = [light[0], light[1], light[2] + 1], halfLength = Math.hypot(...half);
  half[0] /= halfLength; half[1] /= halfLength; half[2] /= halfLength;
  const hmap = maps.heightMap, mw = maps.width, mh = maps.height;
  const sample = (x, y) => hmap[clamp(Math.round(y * mh / height), 0, mh - 1) * mw + clamp(Math.round(x * mw / width), 0, mw - 1)];
  const k = slope * MAX_RELIEF_MM / 255 * 14;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    const nx = -(sample(x + 1, y) - sample(x - 1, y)) * k, ny = (sample(x, y + 1) - sample(x, y - 1)) * k;
    const length = Math.hypot(nx, ny, 1), n = [nx / length, ny / length, 1 / length];
    const diffuse = n[0] * light[0] + n[1] * light[1] + n[2] * light[2];
    const shade = clamp(1 + (diffuse - light[2]) * 2.6, .45, 1.55);
    const spec = Math.max(0, n[0] * half[0] + n[1] * half[1] + n[2] * half[2]) ** 40;
    const mx = clamp(Math.round(x * mw / width), 0, mw - 1), my = clamp(Math.round(y * mh / height), 0, mh - 1);
    const foil = maps.foil[my * mw + mx] / 255, gloss = maps.gloss[my * mw + mx] / 255;
    const shine = (spec * (.35 + 1.5 * foil + .7 * gloss) + gloss * .05 + foil * .12) * 255;
    for (let c = 0; c < 3; c++) {
      const base = data[i + c] * shade;
      out[i + c] = base + (foil ? (255 - base) * Math.min(.9, shine / 255) * .9 : shine * .6);
    }
    out[i + 3] = 255;
    if (x === width - 1 && (y & 7) === 7) yield;
  }
  return out;
}

// ---- browser wrapper ----------------------------------------------------------------------

async function decode(source, signal) {
  if (typeof source !== 'string') return source;
  if (typeof Image === 'undefined') throw new Error('Sin imágenes en este entorno');
  const image = new Image();
  image.decoding = 'async';
  image.src = source;
  await Promise.race([
    typeof image.decode === 'function' ? image.decode() : new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('La portada tardó demasiado')), 4000)),
    new Promise((_, reject) => signal?.addEventListener('abort', () => reject(abortError()), { once: true }))
  ]);
  return image;
}

function dimensionsOf(drawable) {
  return { width: drawable.naturalWidth || drawable.videoWidth || drawable.displayWidth || drawable.width,
    height: drawable.naturalHeight || drawable.videoHeight || drawable.displayHeight || drawable.height };
}

function raster(drawable, long) {
  const natural = dimensionsOf(drawable), size = fitDimensions(natural.width, natural.height, long);
  const canvas = document.createElement('canvas');
  canvas.width = size.width; canvas.height = size.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
  context.drawImage(drawable, 0, 0, size.width, size.height);
  const { data } = context.getImageData(0, 0, size.width, size.height);
  // Transparent corners (a cutout cover) read as the dark of the board, never as black noise.
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

/** Find, rank and preview three relief proposals for a cover (URL or decoded
 * image). Heavy loops run in main-thread slices; pass `signal` to cancel. */
export async function analyzeCoverRelief(coverUrl, { title = '', author = '', signal } = {}) {
  void title; void author; // the picture decides: names never add a claim the pixels do not support
  const stats = { slices: 0, longestSliceMs: 0, ms: 0, durations: [] };
  const drawable = await decode(coverUrl, signal);
  const work = raster(drawable, WORK_SIZE);
  const found = await runSliced(analyzePixels(work), { signal, stats });
  const proposals = [];
  for (const choice of found.chosen) {
    const maps = await runSliced(buildMapsFromPixels(work, work, choice, found.seed), { signal, stats });
    const { label, description } = describe(choice);
    proposals.push({ id: choice.id, label, description, strength: FAMILIES[choice.id].strength,
      thumbnail: await thumbnailOf(work, maps, task => runSliced(task, { signal, stats })), confidence: Math.round(choice.confidence * 100) / 100, detected: choice.detected });
  }
  return { proposals, analysis: { width: work.width, height: work.height, seed: found.seed, photo: found.feats.photo,
    busy: Math.round(found.feats.busy * 1000) / 1000, strokeFraction: Math.round(found.feats.strokeFraction * 1000) / 1000,
    candidates: found.candidates.map(item => ({ id: item.id, confidence: Math.round(item.confidence * 100) / 100, facts: item.facts })),
    ms: Math.round(stats.ms), slices: stats.slices, longestSliceMs: Math.round(stats.longestSliceMs * 10) / 10,
    medianSliceMs: Math.round(quantile(stats.durations, .5) * 10) / 10, p95SliceMs: Math.round(quantile(stats.durations, .95) * 10) / 10 } };
}

/** The maps of one relief choice for a cover: `height` (bytes, in
 * MAX_RELIEF_MM units), `foil` and `gloss` canvases at the cover's aspect,
 * plus `normal` (tangent-space RGBA) ready for a texture. The choice's family
 * is re-detected with the same seed, so nothing but `{ id, strength }` has to
 * be stored. */
export async function buildReliefMaps(coverUrl, relief, { maxSize = MAP_SIZE, signal } = {}) {
  const choice = normalizeCoverRelief(relief);
  if (!choice) return null;
  const stats = { slices: 0, longestSliceMs: 0, ms: 0 };
  const drawable = await decode(coverUrl, signal);
  const work = raster(drawable, WORK_SIZE), hires = raster(drawable, clamp(maxSize, 64, MAP_SIZE));
  const found = await runSliced(analyzePixels(work), { signal, stats });
  // The saved family may no longer be one of the three (a newer detector, a
  // different thumbnail of the same book): fall back to its suggestion.
  let selection = found.candidates.find(item => item.id === choice.id) ?? found.chosen.find(item => item.id === choice.id);
  if (!selection) selection = await runSliced(suggestion(choice.id, work), { signal, stats });
  const maps = await runSliced(buildMapsFromPixels(work, hires, selection, found.seed), { signal, stats });
  const normal = await runSliced(heightToNormals(maps), { signal, stats });
  return { height: new ImageData(grayToRgba(maps.heightMap), maps.width, maps.height),
    foil: new ImageData(grayToRgba(maps.foil), maps.width, maps.height), gloss: new ImageData(grayToRgba(maps.gloss), maps.width, maps.height),
    normal, pixels: maps, size: { width: maps.width, height: maps.height }, foilColor: maps.foilColor,
    stats: { ms: Math.round(stats.ms), longestSliceMs: stats.longestSliceMs, slices: stats.slices } };
}

function grayToRgba(gray) {
  const out = new Uint8ClampedArray(gray.length * 4);
  for (let i = 0; i < gray.length; i++) { out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = gray[i]; out[i * 4 + 3] = 255; }
  return out;
}

/** Individual steps, exposed so tests can exercise each detector on its own. */
export const internals = { featuresOf, detectLettering, detectFoil, detectFrame, detectBand, detectSubject, detectVarnish, metalMask, recipeMask, mapsFor, suggestedFrame, roundedRect };
