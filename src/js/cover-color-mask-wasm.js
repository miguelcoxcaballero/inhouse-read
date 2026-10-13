// A prepared source belongs to one generator job, never a book/model cache.
// Other jobs fall back immediately while the bounded shared lease is occupied.
const PIXEL_LIMIT = 512 * 512, CHUNK = 1024;
const align8 = bytes => Math.ceil(bytes / 8) * 8;
let currentLease = null;
// Only complete, privately prepared masks reach proposal analysis. Weak keys
// retain neither the image nor a mask after its analysis is discarded.
const coverage = new WeakMap();

export function* countPreparedMaskPixels(mask) {
  const saved = coverage.get(mask);
  // Consume once, before the caller can expose or edit the returned mask.
  coverage.delete(mask);
  if (saved !== undefined) {
    for (let end = 4096; end <= mask.length; end += 4096) yield;
    return saved;
  }
  let pixels = 0;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] > 0) pixels++;
    if ((i & 4095) === 4095) yield;
  }
  return pixels;
}

export function* prepareColorMaskJob(core, image, rgbToOklab) {
  const { width, height, data } = image || {};
  if (currentLease || typeof core?.relief_color_mask_pixels !== 'function' || !core.memory
    || typeof core.alloc_f64 !== 'function' || typeof core.free_f64 !== 'function'
    || typeof rgbToOklab !== 'function' || !Number.isInteger(width) || !Number.isInteger(height)
    || width < 1 || height < 1 || width * height > PIXEL_LIMIT
    || !(data instanceof Uint8Array || data instanceof Uint8ClampedArray) || data.length !== width * height * 4
    // Growing the arena could detach an aliased source before it is sampled.
    // Browser ImageData is independent; unsupported callers keep the JS path.
    || data.buffer === core.memory.buffer) return null;
  const count = width * height, alphaOffset = count * 3 * 8;
  const outputOffset = alphaOffset + align8(count), outputLength = Math.min(CHUNK, count);
  const length = (outputOffset + align8(outputLength * 4)) / 8;
  const lease = {}; currentLease = lease;
  let pointer = 0, disposed = false, handedOff = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    try { if (pointer) core.free_f64(pointer, length); }
    finally { if (currentLease === lease) currentLease = null; }
  };
  try {
    pointer = core.alloc_f64(length);
    if (!pointer) return null;
    for (let from = 0; from < count; from += CHUNK) {
      // Any interleaved numeric job may grow memory between generator steps.
      let lab = new Float64Array(core.memory.buffer, pointer, count * 3);
      let alpha = new Uint8Array(core.memory.buffer, pointer + alphaOffset, count);
      for (let i = from, end = Math.min(count, from + CHUNK); i < end; i++) {
        const at = i * 4; alpha[i] = data[at + 3];
        if (alpha[i] >= 128) {
          const color = rgbToOklab(data[at], data[at + 1], data[at + 2]), offset = i * 3;
          // Production conversion is pure. A generic callback may run another
          // numeric job synchronously, so check once before writing all channels.
          if (!lab.byteLength) {
            lab = new Float64Array(core.memory.buffer, pointer, count * 3);
            alpha = new Uint8Array(core.memory.buffer, pointer + alphaOffset, count);
          }
          lab[offset] = color[0]; lab[offset + 1] = color[1]; lab[offset + 2] = color[2];
        }
      }
      if (from + CHUNK <= count) yield;
    }
    const job = { dispose,
      *mask(target, tolerance, countCoverage = false) {
        if (disposed || !target || target.length !== 3 || !Array.from(target).every(Number.isFinite)
          || !Number.isFinite(tolerance) || tolerance <= 0 || tolerance > 12) return null;
        let completed = false;
        try {
          const out = new Float32Array(count);
          const counted = countCoverage && typeof core.relief_color_mask_count === 'function';
          const kernel = counted ? core.relief_color_mask_count : core.relief_color_mask_pixels;
          let pixels = 0;
          for (let from = 0; from < count; from += CHUNK) {
            if (disposed) return null;
            const end = Math.min(count, from + CHUNK);
            const result = kernel.call(core, pointer, pointer + alphaOffset, pointer + outputOffset,
              count, from, end, target[0], target[1], target[2], tolerance);
            if (counted ? !Number.isInteger(result) || result < 1 || result > end - from + 1 : result !== 1) return null;
            if (counted) pixels += result - 1;
            out.set(new Float32Array(core.memory.buffer, pointer + outputOffset, end - from), from);
            if (from + CHUNK <= count) yield;
          }
          completed = true;
          if (counted) coverage.set(out, pixels);
          return out;
        } catch { return null; }
        finally { if (!completed) dispose(); }
      },
    };
    handedOff = true;
    return job;
  } catch { return null; }
  finally { if (!handedOff) dispose(); }
}
