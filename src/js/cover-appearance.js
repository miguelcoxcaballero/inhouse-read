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

function fontMask(context, title, candidate, size, upper, align, maxWidth) {
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
  const raw = linesContext.getImageData(0, 0, maxWidth, linesCanvas.height).data;
  const coords = [];
  let minX = maxWidth, minY = linesCanvas.height, maxX = -1, maxY = -1;
  for (let y = 0; y < linesCanvas.height; y += 1) {
    for (let x = 0; x < maxWidth; x += 1) {
      if (raw[(y * maxWidth + x) * 4 + 3] < 100) continue;
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }
  }
  if (maxX < minX || maxY < minY) return null;
  const contentWidth = maxX - minX + 1, contentHeight = maxY - minY + 1;
  const mask = new Uint8Array(contentWidth * contentHeight);
  for (let y = 0; y < contentHeight; y += 1) {
    for (let x = 0; x < contentWidth; x += 1) {
      const at = ((minY + y) * maxWidth + minX + x) * 4 + 3;
      mask[y * contentWidth + x] = raw[at] >= 100 ? 1 : 0;
    }
  }
  const perimeter = [], foreground = [], background = [];
  for (let y = 1; y < contentHeight - 1; y += 1) {
    for (let x = 1; x < contentWidth - 1; x += 1) {
      const at = y * contentWidth + x;
      if (mask[at]) foreground.push([x, y]);
      else background.push([x, y]);
      if (!mask[at]) continue;
      if (!mask[at - 1] || !mask[at + 1] || !mask[at - contentWidth] || !mask[at + contentWidth]) {
        perimeter.push([x, y]);
      }
    }
  }
  if (perimeter.length < 8) return null;
  const sampleEvery = Math.max(1, Math.ceil(perimeter.length / 280));
  const samplePixels = (points, limit = 500) => {
    const every = Math.max(1, Math.ceil(points.length / limit));
    return points.filter((_, index) => index % every === 0);
  };
  return {
    width: contentWidth,
    height: contentHeight,
    mask,
    perimeter: perimeter.filter((_, index) => index % sampleEvery === 0),
    foreground: samplePixels(foreground),
    background: samplePixels(background)
  };
}

async function matchTitleFont(gray, width, height, title) {
  if (!title || String(title).trim().length < 3 || typeof document === 'undefined') return null;
  const scoreByFamily = [];
  const work = document.createElement('canvas');
  work.width = width; work.height = Math.floor(height * 0.82);
  const context = work.getContext('2d');
  if (!context || width < 48 || work.height < 48) return null;
  const edges = edgeMap(gray, width, height);
  const sizes = [11, 16, 22, 29];
  for (const candidate of FONT_CANDIDATES) {
    let familyScore = 0;
    for (const upper of [false, true]) {
      for (const align of ['center', 'left', 'right']) {
        for (const size of sizes) {
          const mask = fontMask(context, String(title), candidate, size, upper, align, width);
          if (!mask || mask.width > width - 2 || mask.height > work.height - 8) continue;
          const scoreAt = (x, y) => {
            let total = 0;
            for (const [mx, my] of mask.perimeter) {
              const at = (y + my) * width + x + mx;
              // A one-pixel tolerance handles antialiasing and tiny image
              // resizes without making unrelated photographic texture win.
              total += Math.max(edges[at], edges[at - 1], edges[at + 1], edges[at - width], edges[at + width]);
            }
            const meanAt = points => {
              if (!points.length) return 0;
              let sum = 0;
              for (const [mx, my] of points) sum += gray[(y + my) * width + x + mx];
              return sum / points.length;
            };
            const textContrast = Math.abs(meanAt(mask.foreground) - meanAt(mask.background));
            return total / mask.perimeter.length + textContrast * .8;
          };
          const shapeScoreAt = (x, y) => {
            let border = 0, borderCount = 0;
            for (let offset = -2; offset < mask.width + 2; offset += 3) {
              for (const edgeY of [y - 2, y + mask.height + 1]) {
                if (edgeY < 0 || edgeY >= height) continue;
                border += gray[edgeY * width + clamp(x + offset, 0, width - 1)];
                borderCount += 1;
              }
            }
            for (let offset = -2; offset < mask.height + 2; offset += 3) {
              for (const edgeX of [x - 2, x + mask.width + 1]) {
                if (edgeX < 0 || edgeX >= width) continue;
                border += gray[clamp(y + offset, 0, height - 1) * width + edgeX];
                borderCount += 1;
              }
            }
            const background = border / Math.max(1, borderCount);
            const brightText = background < 128;
            const threshold = brightText ? background + 46 : background - 46;
            let intersection = 0, union = 0;
            for (let my = 0; my < mask.height; my += 1) {
              for (let mx = 0; mx < mask.width; mx += 1) {
                const predicted = mask.mask[my * mask.width + mx] === 1;
                const value = gray[(y + my) * width + x + mx];
                const observed = brightText ? value > threshold : value < threshold;
                if (predicted && observed) intersection += 1;
                if (predicted || observed) union += 1;
              }
            }
            return union ? intersection / union : 0;
          };
          let bestX = 1, bestY = 5, maskScore = 0;
          for (let y = 5; y <= work.height - mask.height - 2; y += 8) {
            for (let x = 1; x <= width - mask.width - 1; x += 8) {
              const score = scoreAt(x, y);
              if (score > maskScore) { maskScore = score; bestX = x; bestY = y; }
            }
          }
          // Refine only around the strongest coarse match rather than scanning
          // every pixel on every cover; this keeps large libraries responsive.
          let matchedShapeScore = 0;
          for (let y = Math.max(5, bestY - 8); y <= Math.min(work.height - mask.height - 2, bestY + 8); y += 3) {
            for (let x = Math.max(1, bestX - 8); x <= Math.min(width - mask.width - 1, bestX + 8); x += 3) {
              const coarse = scoreAt(x, y);
              const shape = shapeScoreAt(x, y);
              const combined = shape * 400 + coarse * .12;
              if (combined > matchedShapeScore) matchedShapeScore = combined;
            }
          }
          if (matchedShapeScore > familyScore) familyScore = matchedShapeScore;
        }
      }
    }
    scoreByFamily.push({ candidate, score: familyScore });
    // Let the browser paint between font families when an entire shelf of
    // covers is being analyzed together.
    await new Promise(resolve => setTimeout(resolve, 0));
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
    const font = await matchTitleFont(gray, width, height, title) || visualFallback(gray, width, height);
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
