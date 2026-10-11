// Only bounded sampled RGBA crosses the WASM boundary. Browser colour/contrast
// formatting and Math.round remain in the host; no complete image is retained.
const MAX_SAMPLES = 32768;

export function rustDominantCoverRgb(core, data, width, height) {
  if (typeof core?.cover_dominant_rgb !== 'function' || !core.memory
    || typeof core.alloc_f64 !== 'function' || typeof core.free_f64 !== 'function'
    || !(data instanceof Uint8Array || data instanceof Uint8ClampedArray)
    || !Number.isSafeInteger(width) || width < 1 || !Number.isSafeInteger(height) || height < 1) return null;
  const pixels = width * height;
  if (!Number.isSafeInteger(pixels) || pixels * 4 > data.length) return null;
  const stride = Math.max(1, Math.floor(Math.sqrt(pixels / 1800)));
  const count = Math.ceil(width / stride) * Math.ceil(height / stride);
  if (!Number.isSafeInteger(count) || count > MAX_SAMPLES) return null;
  // Preserve the original empty-sample shortcut before allocating/copying an
  // arena. Ordinary opaque covers stop at their first sampled pixel.
  let included = false;
  scan: for (let y = 0; y < height; y += stride) for (let x = 0; x < width; x += stride) {
    if (data[(y * width + x) * 4 + 3] >= 48) { included = true; break scan; }
  }
  if (!included) return [90, 65, 48];
  const outputOffset = Math.ceil(count * 4 / 8) * 8;
  const length = outputOffset / 8 + 3;
  let pointer;
  try { pointer = core.alloc_f64(length); } catch { return null; }
  if (!pointer) return null;
  try {
    const samples = new Uint8Array(core.memory.buffer, pointer, count * 4);
    if (stride === 1) samples.set(data.subarray(0, count * 4));
    else {
      let at = 0;
      for (let y = 0; y < height; y += stride) for (let x = 0; x < width; x += stride) {
        const offset = (y * width + x) * 4;
        samples[at++] = data[offset]; samples[at++] = data[offset + 1];
        samples[at++] = data[offset + 2]; samples[at++] = data[offset + 3];
      }
    }
    core.cover_dominant_rgb(pointer, count, pointer + outputOffset);
    const rgb = new Float64Array(core.memory.buffer, pointer + outputOffset, 3);
    return [Math.round(rgb[0]), Math.round(rgb[1]), Math.round(rgb[2])];
  } catch { return null; }
  finally { core.free_f64(pointer, length); }
}
