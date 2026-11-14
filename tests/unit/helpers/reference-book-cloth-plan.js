// Frozen from src/js/book-surface-wasm.js (1.7.328): the bridge that asked the numeric core for a cloth's plan
// while the stream of a book lived in JavaScript. Production plans a cloth inside the shelf module, on the
// book's native stream (rust-ui/src/spine_surface.rs, paint_cloth); the frozen spine and book model keep
// driving the core's own copy of the kernel through this bridge.
const available = (core, name) => typeof core?.[name] === 'function'
  && core.memory && typeof core.alloc_f64 === 'function' && typeof core.free_f64 === 'function';

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
