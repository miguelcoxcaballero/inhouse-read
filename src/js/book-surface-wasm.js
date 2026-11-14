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
