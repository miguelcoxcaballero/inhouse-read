import { resolveHostMath } from './host-math.js';
// Fixed production rasters, unchanged dimensions and filtering. Each result
// owns its bytes; one bounded arena is released before returning to Three. The
// threads' sines are asked of the core and answered with the engine's own Math.
const available = (core, name) => typeof core?.[name] === 'function'
  && core.memory && typeof core.alloc_f64 === 'function' && typeof core.free_f64 === 'function';
function raster(core, bytes, offset, generate) {
  const count = Math.ceil((offset + bytes) / 8);
  let pointer;
  try { pointer = core.alloc_f64(count); } catch { return null; }
  if (!pointer) return null;
  try {
    if (generate(pointer) !== 1) return null;
    return new Uint8Array(new Uint8Array(core.memory.buffer, pointer + offset, bytes));
  } catch { return null; }
  finally { core.free_f64(pointer, count); }
}
export function rustBookSurfacePixels(core, kind) {
  if (!available(core, 'book_surface_pixels') || !available(core, 'book_surface_plan') || !['cloth', 'paper'].includes(kind)) return null;
  const askedOffset = 8 * 8, fieldOffset = askedOffset + 8 * 3 * 8, outputOffset = fieldOffset + 128 * 128 * 4;
  return raster(core, 128 * 128 * 4, outputOffset, pointer => {
    const wanted = kind === 'cloth' ? 0 : 1;
    resolveHostMath(core, pointer + askedOffset, pointer, core.book_surface_plan(wanted, pointer + askedOffset));
    return core.book_surface_pixels(wanted, pointer, pointer + fieldOffset, pointer + outputOffset);
  });
}
export function rustRibbonNotchPixels(core, width = 16, height = 64) {
  if (!available(core, 'book_ribbon_notch') || ![width, height].every(n => Number.isInteger(n) && n > 0 && n <= 512)) return null;
  return raster(core, width * height * 4, 0, pointer => core.book_ribbon_notch(width, height, pointer));
}

export function rustBookWeavePixels(core) {
  if (!available(core, 'book_weave_pixels') || !available(core, 'book_weave_plan')) return null;
  const askedOffset = 4 * 8, fieldOffset = askedOffset + 4 * 3 * 8, outputOffset = fieldOffset + 64 * 64 * 4;
  const data = raster(core, 128 * 128 * 8, outputOffset, pointer => {
    resolveHostMath(core, pointer + askedOffset, pointer, core.book_weave_plan(pointer + askedOffset));
    return core.book_weave_pixels(pointer, pointer + fieldOffset, pointer + outputOffset);
  });
  return data && { color:data.subarray(0, 65536), channels:data.subarray(65536) };
}

/** Own every output before releasing scratch; failed plans never advance the PRNG. */
export function rustBookClothPlan(core, seed, width, metal = false) {
  if (!available(core, 'book_cloth_plan') || !Number.isFinite(width) || width < 0 || width > 8192
    || !Number.isInteger(seed) || seed < -2147483648 || seed > 4294967295) return null;
  const fieldWidth = Math.max(4, Math.round(width / 34));
  const bytes = fieldWidth * 30 * 4, commands = (metal ? 40 : 136) * 6;
  const offset = Math.ceil(bytes / 8) * 8, length = offset / 8 + commands + 1;
  let pointer = 0;
  try {
    pointer = core.alloc_f64(length);
    if (!pointer || core.book_cloth_plan(seed >>> 0, width, metal ? 1 : 0, fieldWidth, pointer, pointer + offset) !== 1) return null;
    const values = new Float64Array(core.memory.buffer, pointer + offset, commands + 1);
    return { fieldWidth, pixels: new Uint8ClampedArray(core.memory.buffer, pointer, bytes).slice(),
      commands: values.slice(0, commands), state: values[commands] | 0 };
  } catch { return null; }
  finally { if (pointer) core.free_f64(pointer, length); }
}
