import { loadedRustCore, requireRustCore } from './rust-core.js';
import { rustCoverColor } from './cover-color-wasm.js';
import { rustGlyphMask, rustPrepareCoverPixels, rustNearEdgeMap } from './font-glyph-wasm.js';
import { createRustFontScorer } from './font-score-wasm.js';
export { scoreFontMask } from './font-score-core.js';
import { createRustFontWrapCache, rustFontSearchPlan, rustFontFamilyMax, rustFontFamilySelect } from './font-policy-wasm.js';
import { shelfWorkReady } from './idle-startup.js';
import { getRustShelf, loadRustShelf } from './rust-shelf.js';
/*
 * Appearance extracted from a book cover image. This stays local to the
 * browser: a small pixel sample supplies the dominant binding colour, while
 * the known book title is matched against a few installed web-font families.
 * The font match is necessarily approximate for raster covers (the source
 * font is not embedded in a JPEG), but it follows the lettering actually
 * visible on the cover instead of assigning every book the same serif.
 *
 * The analysis itself (decode bounds, sample, colour, font loads, the single-flight search and its
 * slices) is rust-ui/src/cover_appearance.rs. This module hands it the numeric core's bridges, the
 * generator slice driver and the Worker client, and keeps the two values a page owns between analyses.
 */

// Relative modules cannot resolve when this self-contained analyzer is imported from a data URL.
// Load the production Worker client only for matching; keep the original sliced scorer on failure.
let fontScoreClientTask;
async function openFontScoreJob(context) {
  const client = await (fontScoreClientTask ??= import('./font-score-client.js').catch(() => null));
  return client ? client.openFontScoreJob(context) : null;
}

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

/** Return a safe physical cover width/height ratio from decoded image dimensions. */
export function coverAspectRatio(width, height) {
  const ratio = Number(width) / Number(height);
  if (!Number.isFinite(ratio) || ratio <= 0) return null;
  // Keep normal portrait, square, and landscape covers exact while bounding
  // malformed thumbnails that would make the 3D book unusably wide or thin.
  return clamp(ratio, 0.25, 2.5);
}

/** Pure pixel helper, exported so the colour and contrast rules stay testable. */
export function coverColorFromPixels(data, width, height) {
  if (!data || !Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) return null;
  const style = rustCoverColor(loadedRustCore(), data, width, height);
  if (!style) throw new Error('Invalid cover pixels');
  return style;
}

export function glyphMask(raw, maxWidth, rows, stride = maxWidth) {
  const mask = rustGlyphMask(loadedRustCore(), raw, maxWidth, rows, stride);
  if (mask === undefined) throw new Error('Invalid glyph raster');
  return mask;
}

// The raster of one mask stays here, one call from the Rust search: it is about twenty canvas calls, and
// 144 masks a cover made that many imports measurably slower than this function.
function fontMask(title, before, after, plan, maxWidth, rows, wraps, surface) {
  const [upper, alignment, size, canvasHeight, x, lineHeight, lineWidth, key] = plan;
  const align = ['center', 'left', 'right'][alignment];
  const linesCanvas = surface.canvas ||= document.createElement('canvas');
  if (linesCanvas.width !== maxWidth) linesCanvas.width = maxWidth;
  if (linesCanvas.height !== canvasHeight) linesCanvas.height = canvasHeight;
  const linesContext = surface.context ||= linesCanvas.getContext('2d', { willReadFrequently: true });
  if (!linesContext) return null;
  linesContext.clearRect(0, 0, linesCanvas.width, linesCanvas.height);
  linesContext.font = before + size + after;
  linesContext.textAlign = align;
  linesContext.textBaseline = 'top';
  linesContext.fillStyle = '#fff';
  const lines = wraps.lines(linesContext, upper ? title.toLocaleUpperCase() : title, lineWidth, key);
  if (!lines.length) return null;
  lines.forEach((line, index) => {
    linesContext.fillText(line, x, 3 + index * lineHeight, lineWidth);
  });
  const mask = glyphMask(linesContext.getImageData(0, 0, maxWidth, linesCanvas.height).data, maxWidth, linesCanvas.height);
  return mask && loadedRustCore().font_mask_fits(mask.width, mask.height, maxWidth, rows) ? mask : null;
}

export function nearEdgeMap(edges, width) {
  return rustNearEdgeMap(loadedRustCore(), edges, width);
}

// The search is a few hundred million operations: run it in slices short
// enough that scrolling and the animation loop keep their frames, and one
// cover at a time so a whole shelf of new books does not pile up long tasks.
const SLICE_MS = 2;
// A message event queues behind whatever else is waiting (input, timers) and
// has no 4 ms timer clamp; scheduler.yield() would run before all of them.
const yieldToMain = () => new Promise(resolve => {
  if (typeof MessageChannel === 'undefined') { setTimeout(resolve, 0); return; }
  const { port1, port2 } = new MessageChannel();
  port1.onmessage = () => { port1.close(); port2.close(); resolve(); };
  port2.postMessage(0);
});

/** Run a generator to completion, handing the main thread back whenever a
 * slice has used its budget. Resolves to the generator's return value.
 * `onSlice(ms)` (optional) hears how long each slice ran before it yielded. */
export async function runInSlices(task, sliceMs = SLICE_MS, onSlice) {
  let sliceStart = performance.now();
  for (let step = task.next(); ; step = task.next()) {
    if (step.done) { onSlice?.(performance.now() - sliceStart); return step.value; }
    if (performance.now() - sliceStart >= sliceMs) {
      onSlice?.(performance.now() - sliceStart);
      await yieldToMain(); await shelfWorkReady(); sliceStart = performance.now();
    }
  }
}

const host = {
  core: loadedRustCore, requireCore: requireRustCore, ready: shelfWorkReady, color: rustCoverColor, mask: fontMask,
  prepare: rustPrepareCoverPixels, scorer: createRustFontScorer, wraps: createRustFontWrapCache, plan: rustFontSearchPlan,
  max: rustFontFamilyMax, select: rustFontFamilySelect, open: openFontScoreJob, slices: runInSlices, yieldToMain,
  noop: () => {},
  // One cover is searched at a time; the six candidate faces are requested once per page.
  turn: Promise.resolve(), fonts: undefined
};
// The shelf's first render awaited the module; an analysis asked for earlier waits for it once.
const withShelf = use => {
  const shelf = getRustShelf();
  return shelf ? use(shelf) : loadRustShelf().then(loaded => loaded ? use(loaded) : null);
};

/** Decode only the dimensions when a caller needs the correct model shape fast. */
export function readCoverAspectRatio(url) {
  return withShelf(shelf => shelf.cover_aspect_read(url));
}

/** Analyze an already-decodable image URL. Returns null for missing/unsafe images. */
export function analyzeCoverAppearance(url, title = '', options) {
  return withShelf(shelf => shelf.cover_appearance_analyze(host, url, title, options));
}

export function withCoverAppearance(style, appearance) {
  if (!appearance) return style;
  return {
    ...style,
    color: appearance.color || style.color,
    shade: appearance.shade || style.shade,
    ink: appearance.ink || style.ink,
    fontFamily: appearance.fontFamily || style.fontFamily || 'Playfair Display',
    fontCanvasFamily: appearance.fontCanvasFamily || appearance.fontFamily || style.fontCanvasFamily || style.fontFamily || 'Playfair Display',
    fontFallback: appearance.fontFallback || style.fontFallback || 'Georgia, serif',
    fontWeight: clamp(Number(appearance.fontWeight) || Number(style.fontWeight) || 700, 400, 800),
    coverRatio: coverAspectRatio(appearance.aspectRatio, 1) || style.coverRatio || 0.66,
    appearanceSource: appearance.source || 'cover'
  };
}
