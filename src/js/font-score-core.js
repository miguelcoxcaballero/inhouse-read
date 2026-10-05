// Numeric matcher: extracted unchanged from cover-appearance.js. No DOM or font loading.
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

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

