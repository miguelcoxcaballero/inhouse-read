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

function rgbHex(r, g, b) {
  return `#${[r, g, b].map(value => Math.round(value).toString(16).padStart(2, '0')).join('')}`;
}

function linearChannel(value) {
  const channel = value / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(r, g, b) {
  return 0.2126 * linearChannel(r) + 0.7152 * linearChannel(g) + 0.0722 * linearChannel(b);
}

function contrastInk(r, g, b) {
  const luminance = relativeLuminance(r, g, b);
  const white = 1.05 / (luminance + 0.05);
  const dark = (luminance + 0.05) / (0.025 + 0.05);
  return white >= dark ? '#fffaf0' : '#171512';
}

function darken(r, g, b, amount = 0.24) {
  return rgbHex(r * (1 - amount), g * (1 - amount), b * (1 - amount));
}

function dominantRgb(data, width, height) {
  const samples = [];
  const stride = Math.max(1, Math.floor(Math.sqrt((width * height) / 1800)));
  for (let y = 0; y < height; y += stride) {
    for (let x = 0; x < width; x += stride) {
      const offset = (y * width + x) * 4;
      const alpha = data[offset + 3];
      if (alpha < 48) continue;
      samples.push([data[offset], data[offset + 1], data[offset + 2]]);
    }
  }
  if (!samples.length) return [90, 65, 48];

  // Three-centre k-means is small enough for a phone cover and avoids letting
  // a handful of title pixels or fine photographic noise decide the binding.
  const centers = [samples[0]];
  while (centers.length < 3) {
    let farthest = samples[0], farthestDistance = -1;
    for (const sample of samples) {
      const distance = Math.min(...centers.map(center =>
        (sample[0] - center[0]) ** 2 + (sample[1] - center[1]) ** 2 + (sample[2] - center[2]) ** 2
      ));
      if (distance > farthestDistance) { farthest = sample; farthestDistance = distance; }
    }
    centers.push(farthest);
  }

  let assignments = new Uint8Array(samples.length);
  let counts = [0, 0, 0];
  for (let iteration = 0; iteration < 7; iteration += 1) {
    const sums = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    counts = [0, 0, 0];
    for (let index = 0; index < samples.length; index += 1) {
      const sample = samples[index];
      let best = 0, distance = Infinity;
      for (let candidate = 0; candidate < centers.length; candidate += 1) {
        const center = centers[candidate];
        const next = (sample[0] - center[0]) ** 2 + (sample[1] - center[1]) ** 2 + (sample[2] - center[2]) ** 2;
        if (next < distance) { best = candidate; distance = next; }
      }
      assignments[index] = best;
      counts[best] += 1;
      sums[best][0] += sample[0]; sums[best][1] += sample[1]; sums[best][2] += sample[2];
    }
    for (let candidate = 0; candidate < centers.length; candidate += 1) {
      if (!counts[candidate]) continue;
      centers[candidate] = sums[candidate].map(value => value / counts[candidate]);
    }
  }
  let dominant = 0;
  for (let candidate = 1; candidate < counts.length; candidate += 1) {
    if (counts[candidate] > counts[dominant]) dominant = candidate;
  }
  return centers[dominant].map(value => Math.round(value));
}

/** Pure pixel helper, exported so the colour and contrast rules stay testable. */
export function coverColorFromPixels(data, width, height) {
  if (!data || !Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) return null;
  const [r, g, b] = dominantRgb(data, width, height);
  const color = rgbHex(r, g, b);
  return { color, shade: darken(r, g, b), ink: contrastInk(r, g, b) };
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

function edgeMap(gray, width, height) {
  const edges = new Float32Array(gray.length);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const at = y * width + x;
      edges[at] = Math.min(255,
        Math.abs(gray[at + 1] - gray[at - 1]) + Math.abs(gray[at + width] - gray[at - width]));
    }
  }
  return edges;
}

/** Pure half of the glyph raster: crop the text's alpha to its bounding box and
 * keep the points the matcher scores. Points are stored as `y * stride + x`
 * offsets so a placement only adds one base index per sample. */
export function glyphMask(raw, maxWidth, rows, stride = maxWidth) {
  let minX = maxWidth, minY = rows, maxX = -1, maxY = -1;
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < maxWidth; x += 1) {
      if (raw[(y * maxWidth + x) * 4 + 3] < 100) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < minX || maxY < minY) return null;
  const contentWidth = maxX - minX + 1, contentHeight = maxY - minY + 1;
  const mask = new Uint8Array(contentWidth * contentHeight);
  for (let y = 0; y < contentHeight; y += 1) {
    for (let x = 0; x < contentWidth; x += 1) {
      mask[y * contentWidth + x] = raw[((minY + y) * maxWidth + minX + x) * 4 + 3] >= 100 ? 1 : 0;
    }
  }
  const room = Math.max(0, contentWidth - 2) * Math.max(0, contentHeight - 2);
  const perimeter = new Int32Array(room), foreground = new Int32Array(room), background = new Int32Array(room);
  let perimeterCount = 0, foregroundCount = 0, backgroundCount = 0, area = 0;
  for (let y = 1; y < contentHeight - 1; y += 1) {
    for (let x = 1; x < contentWidth - 1; x += 1) {
      const at = y * contentWidth + x, offset = y * stride + x;
      if (!mask[at]) { background[backgroundCount++] = offset; continue; }
      foreground[foregroundCount++] = offset;
      if (!mask[at - 1] || !mask[at + 1] || !mask[at - contentWidth] || !mask[at + contentWidth]) {
        perimeter[perimeterCount++] = offset;
      }
    }
  }
  if (perimeterCount < 8) return null;
  for (let index = 0; index < mask.length; index += 1) area += mask[index];
  // Every n-th point, so at most ~280 edge and ~500 fill samples are scored.
  const thin = (points, count, limit) => {
    const every = Math.max(1, Math.ceil(count / limit)), kept = new Int32Array(Math.ceil(count / every));
    for (let from = 0, to = 0; from < count; from += every) kept[to++] = points[from];
    return kept;
  };
  return {
    width: contentWidth,
    height: contentHeight,
    mask,
    area,
    perimeter: thin(perimeter, perimeterCount, 280),
    foreground: thin(foreground, foregroundCount, 500),
    background: thin(background, backgroundCount, 500)
  };
}

function fontMask(title, candidate, size, upper, align, maxWidth) {
  const linesCanvas = document.createElement('canvas');
  linesCanvas.width = maxWidth;
  linesCanvas.height = Math.ceil(size * 5.5);
  const linesContext = linesCanvas.getContext('2d');
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

/** Each pixel's strongest edge among itself and its four neighbours, so the
 * one-pixel tolerance of the perimeter test costs one lookup instead of five.
 * Rows without a full neighbourhood stay NaN, exactly as the five-way max
 * reads past the array. */
export function nearEdgeMap(edges, width) {
  const near = new Float32Array(edges.length);
  near.fill(NaN, 0, width);
  near.fill(NaN, Math.max(width, edges.length - width));
  for (let at = width; at < edges.length - width; at += 1) {
    near[at] = Math.max(edges[at], edges[at - 1], edges[at + 1], edges[at - width], edges[at + width]);
  }
  return near;
}

function meanAt(gray, base, points) {
  if (!points.length) return 0;
  let sum = 0;
  for (let index = 0; index < points.length; index += 1) sum += gray[base + points[index]];
  return sum / points.length;
}

// A one-pixel tolerance (the near-edge map) handles antialiasing and tiny
// image resizes without making unrelated photographic texture win.
function perimeterScore(gray, near, base, mask) {
  let total = 0;
  const { perimeter } = mask;
  for (let index = 0; index < perimeter.length; index += 1) total += near[base + perimeter[index]];
  const textContrast = Math.abs(meanAt(gray, base, mask.foreground) - meanAt(gray, base, mask.background));
  return total / perimeter.length + textContrast * .8;
}

function shapeScore(gray, width, height, mask, x, y) {
  let border = 0, borderCount = 0;
  for (let offset = -2; offset < mask.width + 2; offset += 3) {
    const column = clamp(x + offset, 0, width - 1), above = y - 2, below = y + mask.height + 1;
    if (above >= 0 && above < height) { border += gray[above * width + column]; borderCount += 1; }
    if (below >= 0 && below < height) { border += gray[below * width + column]; borderCount += 1; }
  }
  for (let offset = -2; offset < mask.height + 2; offset += 3) {
    const row = clamp(y + offset, 0, height - 1) * width, left = x - 2, right = x + mask.width + 1;
    if (left >= 0 && left < width) { border += gray[row + left]; borderCount += 1; }
    if (right >= 0 && right < width) { border += gray[row + right]; borderCount += 1; }
  }
  const background = border / Math.max(1, borderCount);
  const brightText = background < 128;
  const threshold = brightText ? background + 46 : background - 46;
  // union = predicted + observed - both, so one pass counts all three.
  let observed = 0, both = 0;
  for (let my = 0; my < mask.height; my += 1) {
    const row = (y + my) * width + x, cells = my * mask.width;
    for (let mx = 0; mx < mask.width; mx += 1) {
      const value = gray[row + mx];
      if (brightText ? value > threshold : value < threshold) { observed += 1; both += mask.mask[cells + mx]; }
    }
  }
  const union = mask.area + observed - both;
  return union ? both / union : 0;
}

/** Best match of one rendered title against the cover: a coarse scan, then a
 * finer one around the winner. A generator so the caller can pause between
 * rows (every `yield` is a safe point); its return value is the score. */
export function* scoreFontMask(gray, near, width, height, rows, mask) {
  let bestX = 1, bestY = 5, maskScore = 0;
  for (let y = 5; y <= rows - mask.height - 2; y += 8) {
    for (let x = 1; x <= width - mask.width - 1; x += 8) {
      const score = perimeterScore(gray, near, y * width + x, mask);
      if (score > maskScore) { maskScore = score; bestX = x; bestY = y; }
    }
    yield;
  }
  // Refine only around the strongest coarse match rather than scanning
  // every pixel on every cover; this keeps large libraries responsive.
  let matchedShapeScore = 0;
  for (let y = Math.max(5, bestY - 8); y <= Math.min(rows - mask.height - 2, bestY + 8); y += 3) {
    for (let x = Math.max(1, bestX - 8); x <= Math.min(width - mask.width - 1, bestX + 8); x += 3) {
      const coarse = perimeterScore(gray, near, y * width + x, mask);
      const combined = shapeScore(gray, width, height, mask, x, y) * 400 + coarse * .12;
      if (combined > matchedShapeScore) matchedShapeScore = combined;
      yield;
    }
  }
  return matchedShapeScore;
}

function* scoreFamily(candidate, gray, near, width, height, rows, title) {
  let familyScore = 0;
  // A title already in capitals renders the same text in both cases.
  for (const upper of String(title).toLocaleUpperCase() === String(title) ? [false] : [false, true]) {
    for (const align of ['center', 'left', 'right']) {
      for (const size of [11, 16, 22, 29]) {
        yield;
        const mask = fontMask(String(title), candidate, size, upper, align, width);
        if (!mask || mask.width > width - 2 || mask.height > rows - 8) continue;
        const score = yield* scoreFontMask(gray, near, width, height, rows, mask);
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
  port1.onmessage = () => { port1.close(); resolve(); };
  port2.postMessage(0);
});
let matcherTurn = Promise.resolve();

/** Run a generator to completion, handing the main thread back whenever a
 * slice has used its budget. Resolves to the generator's return value. */
export async function runInSlices(task, sliceMs = SLICE_MS) {
  let sliceStart = performance.now();
  for (let step = task.next(); ; step = task.next()) {
    if (step.done) return step.value;
    if (performance.now() - sliceStart >= sliceMs) { await yieldToMain(); sliceStart = performance.now(); }
  }
}

async function matchTitleFont(gray, width, height, title) {
  if (!title || String(title).trim().length < 3 || typeof document === 'undefined') return null;
  const scoreByFamily = [];
  const work = document.createElement('canvas');
  work.width = width; work.height = Math.floor(height * 0.82);
  const context = work.getContext('2d');
  if (!context || width < 48 || work.height < 48) return null;
  const near = nearEdgeMap(edgeMap(gray, width, height), width);
  for (const candidate of FONT_CANDIDATES) {
    const score = await runInSlices(scoreFamily(candidate, gray, near, width, height, work.height, title));
    scoreByFamily.push({ candidate, score });
  }
  scoreByFamily.sort((a, b) => b.score - a.score);
  const best = scoreByFamily[0];
  const runnerUp = scoreByFamily[1];
  // If the image has no readable title, leave the fallback to the visual
  // classification below instead of treating random image edges as letters.
  const margin = runnerUp ? (best.score - runnerUp.score) / Math.max(1, best.score) : 0;
  if (!best || best.score < 18 || margin < .035) return null;
  return best.candidate;
}

function visualFallback(gray, width, height) {
  let edge = 0, variance = 0, sum = 0, sumSquared = 0, count = 0;
  for (let y = 1; y < height - 1; y += 2) {
    for (let x = 1; x < width - 1; x += 2) {
      const at = y * width + x;
      edge += Math.abs(gray[at + 1] - gray[at - 1]) + Math.abs(gray[at + width] - gray[at - width]);
      sum += gray[at]; sumSquared += gray[at] * gray[at]; count += 1;
    }
  }
  if (count) variance = sumSquared / count - (sum / count) ** 2;
  // Quiet, graphic covers tend to use an editorial serif; busy photographic
  // covers favour the clean sans family that survives their visual texture.
  const busy = edge / Math.max(1, count) > 44 || variance > 5200;
  return FONT_CANDIDATES[busy ? 3 : 0];
}

function loadCandidateFonts() {
  if (!document.fonts?.load) return Promise.resolve();
  if (!candidateFontsTask) {
    candidateFontsTask = Promise.allSettled(FONT_CANDIDATES.map(candidate =>
      document.fonts.load(`${candidate.weight} 20px "${candidate.family}"`)
    ));
  }
  return new Promise(resolve => {
    const timer = setTimeout(resolve, 1000);
    candidateFontsTask.then(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/** Analyze an already-decodable image URL. Returns null for missing/unsafe images. */
export async function analyzeCoverAppearance(url, title = '', { matchFont = true } = {}) {
  if (!url || typeof Image === 'undefined' || typeof document === 'undefined') return null;
  const image = new Image();
  image.decoding = 'async';
  image.src = url;
  const decodeTimeout = matchFont ? 3000 : 1200;
  try {
    if (typeof image.decode === 'function') {
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
    else await new Promise((resolve, reject) => {
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
    const color = coverColorFromPixels(pixels, width, height);
    if (!matchFont) return { ...color, aspectRatio, source: 'cover' };
    const gray = new Uint8Array(width * height);
    for (let index = 0; index < gray.length; index += 1) {
      const at = index * 4;
      gray[index] = Math.round(pixels[at] * .299 + pixels[at + 1] * .587 + pixels[at + 2] * .114);
    }
    await loadCandidateFonts();
    const turn = matcherTurn.then(() => matchTitleFont(gray, width, height, title));
    matcherTurn = turn.catch(() => {});
    const font = await turn || visualFallback(gray, width, height);
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
