import { loadedRustCore, requireRustCore } from './rust-core.js';
import { rustCoverColor } from './cover-color-wasm.js';
import { rustGlyphMask, rustPrepareCoverPixels, rustNearEdgeMap } from './font-glyph-wasm.js';
import { createRustFontScorer } from './font-score-wasm.js';
export { scoreFontMask } from './font-score-core.js';
import { shelfWorkReady } from './idle-startup.js';
/*
 * Appearance extracted from a book cover image. This stays local to the
 * browser: a small pixel sample supplies the dominant binding colour, while
 * the known book title is matched against a few installed web-font families.
 * The font match is necessarily approximate for raster covers (the source
 * font is not embedded in a JPEG), but it follows the lettering actually
 * visible on the cover instead of assigning every book the same serif.
 */

const FONT_CANDIDATES = Object.freeze([
  { family: 'Playfair Display', weight: 700, fallback: 'Georgia, serif' },
  { family: 'Lora', weight: 700, fallback: 'Georgia, serif' },
  { family: 'Cormorant Garamond', weight: 700, fallback: 'Georgia, serif' },
  { family: 'DM Sans', weight: 600, fallback: 'Arial, sans-serif' },
  { family: 'Montserrat', weight: 700, fallback: 'Arial, sans-serif' },
  { family: 'Oswald', weight: 600, fallback: 'Arial Narrow, sans-serif' }
]);
let candidateFontsTask;

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

/** Decode only the dimensions when a caller needs the correct model shape fast. */
export async function readCoverAspectRatio(url) {
  if (!url || typeof Image === 'undefined') return null;
  const image = new Image();
  image.decoding = 'async';
  image.src = url;
  let timeout;
  try {
    await Promise.race([
      typeof image.decode === 'function'
        ? image.decode()
        : new Promise((resolve, reject) => {
          image.onload = resolve;
          image.onerror = reject;
        }),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error('La portada tardó demasiado')), 1500);
      })
    ]);
    return coverAspectRatio(image.naturalWidth, image.naturalHeight);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/** Pure pixel helper, exported so the colour and contrast rules stay testable. */
export function coverColorFromPixels(data, width, height) {
  if (!data || !Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) return null;
  const style = rustCoverColor(loadedRustCore(), data, width, height);
  if (!style) throw new Error('Invalid cover pixels');
  return style;
}

function titleLines(context, title, maxWidth) {
  const words = String(title ?? '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const lines = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && context.measureText(candidate).width > maxWidth) {
      lines.push(line);
      line = word;
    } else line = candidate;
  }
  if (line) lines.push(line);
  return lines.slice(0, 4);
}

export function glyphMask(raw, maxWidth, rows, stride = maxWidth) {
  const mask = rustGlyphMask(loadedRustCore(), raw, maxWidth, rows, stride);
  if (mask === undefined) throw new Error('Invalid glyph raster');
  return mask;
}

function fontMask(title, candidate, size, upper, align, maxWidth) {
  const linesCanvas = document.createElement('canvas');
  linesCanvas.width = maxWidth;
  linesCanvas.height = Math.ceil(size * 5.5);
  const linesContext = linesCanvas.getContext('2d', { willReadFrequently: true });
  if (!linesContext) return null;
  linesContext.clearRect(0, 0, linesCanvas.width, linesCanvas.height);
  linesContext.font = `${candidate.weight} ${size}px "${candidate.family}", ${candidate.fallback}`;
  linesContext.textAlign = align;
  linesContext.textBaseline = 'top';
  linesContext.fillStyle = '#fff';
  const lineWidth = maxWidth - 2;
  const lines = titleLines(linesContext, upper ? title.toLocaleUpperCase() : title, lineWidth);
  if (!lines.length) return null;
  const lineHeight = size * 1.08;
  lines.forEach((line, index) => {
    const x = align === 'left' ? 1 : align === 'right' ? maxWidth - 1 : maxWidth / 2;
    linesContext.fillText(line, x, 3 + index * lineHeight, lineWidth);
  });
  return glyphMask(linesContext.getImageData(0, 0, maxWidth, linesCanvas.height).data, maxWidth, linesCanvas.height);
}

export function nearEdgeMap(edges, width) {
  return rustNearEdgeMap(loadedRustCore(), edges, width);
}

function* scoreFamily(candidate, gray, near, width, height, rows, title, scorer = remoteFontScore) {
  let familyScore = 0;
  // A title already in capitals renders the same text in both cases.
  for (const upper of String(title).toLocaleUpperCase() === String(title) ? [false] : [false, true]) {
    for (const align of ['center', 'left', 'right']) {
      for (const size of [11, 16, 22, 29]) {
        yield;
        const mask = fontMask(String(title), candidate, size, upper, align, width);
        if (!mask || mask.width > width - 2 || mask.height > rows - 8) continue;
        const score = yield* scorer(gray, near, width, height, rows, mask);
        if (score > familyScore) familyScore = score;
      }
    }
  }
  return familyScore;
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
let matcherTurn = Promise.resolve();

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

// The same scoreFamily generator rasterizes fonts on the main thread in its original order.
// Only numerical mask scores cross the Worker boundary; bare yields retain the mask-raster budget.
function* remoteFontScore(_gray, _near, _width, _height, _rows, mask) {
  return yield { mask };
}
async function runRemoteFamily(task, scoreMasks) {
  // Scores only select a maximum; they never alter which glyphs are sampled.
  // Build the identical family in short slices, then send its bounded batch.
  const masks = [];
  let sliceStart = performance.now(), step = task.next();
  while (!step.done) {
    if (step.value?.mask) masks.push(step.value.mask);
    if (performance.now() - sliceStart >= SLICE_MS) {
      await yieldToMain(); await shelfWorkReady(); sliceStart = performance.now();
    }
    step = task.next(0);
  }
  return Math.max(0, ...await scoreMasks(masks));
}

async function matchTitleFont(gray, width, height, title, preparedNear) {
  await shelfWorkReady();
  if (!title || String(title).trim().length < 3 || typeof document === 'undefined') return null;
  const scoreByFamily = [];
  const work = document.createElement('canvas');
  work.width = width; work.height = Math.floor(height * 0.82);
  const context = work.getContext('2d');
  if (!context || width < 48 || work.height < 48) return null;
  const near = preparedNear;
  let localScorer = null;
  let workerJob = await openFontScoreJob({ gray, near, width, height, rows:work.height });

  const scoreMasks = async masks => {
    if (workerJob) {
      try { return await workerJob.scoreMany(masks); }
      catch { workerJob.close(); workerJob = null; }
    }
    // Keep the original masks intact for a failed/unavailable Worker.
    localScorer ??= createRustFontScorer(loadedRustCore(), { gray, near, width, height, rows:work.height });
    const scores = [];
    for (const mask of masks) {
      await shelfWorkReady();
      scores.push(await runInSlices(localScorer.steps(mask)));
    }
    return scores;
  };
  try {
    for (const candidate of FONT_CANDIDATES) {
      await shelfWorkReady();
      const task = scoreFamily(candidate, gray, near, width, height, work.height, title, remoteFontScore);
      const score = await runRemoteFamily(task, scoreMasks);
      scoreByFamily.push({ candidate, score });
    }
  } finally { workerJob?.close(); localScorer?.dispose(); }
  scoreByFamily.sort((a, b) => b.score - a.score);
  const best = scoreByFamily[0];
  const runnerUp = scoreByFamily[1];
  // If the image has no readable title, leave the fallback to the visual
  // classification below instead of treating random image edges as letters.
  const margin = runnerUp ? (best.score - runnerUp.score) / Math.max(1, best.score) : 0;
  if (!best || best.score < 18 || margin < .035) return null;
  return best.candidate;
}

function loadCandidateFonts(text) {
  if (!document.fonts?.load) return Promise.resolve();
  if (!candidateFontsTask) {
    candidateFontsTask = Promise.allSettled(FONT_CANDIDATES.map(candidate =>
      document.fonts.load(`${candidate.weight} 20px "${candidate.family}"`)
    ));
  }
  // The default Latin face already covers ASCII/Latin-1. Request additional
  // unicode subsets only when the actual lettering needs them.
  return text && /[^\u0000-\u00ff]/u.test(String(text)) ? Promise.allSettled([candidateFontsTask,...FONT_CANDIDATES.map(candidate =>
    document.fonts.load(`${candidate.weight} 20px "${candidate.family}"`,String(text)))]) : candidateFontsTask;
}

/** Analyze an already-decodable image URL. Returns null for missing/unsafe images. */
export async function analyzeCoverAppearance(url, title = '', { matchFont = true, image:decodedImage } = {}) {
  if (!url || typeof Image === 'undefined' || typeof document === 'undefined') return null;
  const coreReady = requireRustCore();
  // Start compilation alongside decode; observe failures even if decoding fails.
  coreReady.catch(() => {});
  const image = decodedImage || new Image();
  image.decoding = 'async';
  if (!decodedImage) image.src = url;
  const decodeTimeout = matchFont ? 3000 : 1200;
  try {
    if (!decodedImage && typeof image.decode === 'function') {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('La portada tardó demasiado')), decodeTimeout);
        Promise.resolve().then(() => image.decode()).then(value => {
          clearTimeout(timer);
          resolve(value);
        }, error => {
          clearTimeout(timer);
          reject(error);
        });
      });
    }
    else if (!decodedImage) await new Promise((resolve, reject) => {
      image.onload = resolve; image.onerror = reject;
    });
    if (!image.naturalWidth || !image.naturalHeight) return null;
    const aspectRatio = coverAspectRatio(image.naturalWidth, image.naturalHeight);
    const scale = Math.min(1, 192 / image.naturalWidth, 288 / image.naturalHeight);
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return { aspectRatio, source: 'cover' };
    context.drawImage(image, 0, 0, width, height);
    let pixels;
    try {
      pixels = context.getImageData(0, 0, width, height).data;
    } catch {
      // Cross-origin images can still supply their decoded dimensions even
      // when browser security prevents sampling their pixels.
      return { aspectRatio, source: 'cover' };
    }
    const core = await coreReady;
    await shelfWorkReady();
    const color = coverColorFromPixels(pixels, width, height);
    if (!matchFont) return { ...color, aspectRatio, source: 'cover' };
    // Font loading is already required. Let the numeric module finish loading
    // during that wait, before choosing the native or compatibility path.
    await loadCandidateFonts(title);
    const includeEdges = Boolean(title) && String(title).trim().length >= 3 && width >= 48 && Math.floor(height * .82) >= 48;
    const prepared = rustPrepareCoverPixels(core, pixels, width, height, includeEdges);
    if (!prepared) throw new Error('Invalid cover preparation');
    const gray = prepared.gray;
    const turn = matcherTurn.then(() => matchTitleFont(gray, width, height, title, prepared?.near));
    matcherTurn = turn.catch(() => {});
    const font = await turn || FONT_CANDIDATES[prepared.busy ? 3 : 0];
    return {
      ...color,
      fontFamily: font.family,
      fontCanvasFamily: font.family,
      fontFallback: font.fallback,
      fontWeight: font.weight,
      aspectRatio,
      source: 'cover'
    };
  } catch {
    // Canvas may be unavailable in a WebView or reject cross-origin pixels.
    return null;
  }
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
