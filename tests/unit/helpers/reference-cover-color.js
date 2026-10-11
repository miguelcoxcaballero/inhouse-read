// Frozen verbatim from cover-appearance.js at e137376068b82bc7051e85754c755b8334b3916d.
// Only export names changed. Keep independent of the Rust implementation.
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

export function referenceDominantRgb(data, width, height) {
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
export function referenceCoverColorFromPixels(data, width, height) {
  if (!data || !Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) return null;
  const [r, g, b] = referenceDominantRgb(data, width, height);
  const color = rgbHex(r, g, b);
  return { color, shade: darken(r, g, b), ink: contrastInk(r, g, b) };
}
