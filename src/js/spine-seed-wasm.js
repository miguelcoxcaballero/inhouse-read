import {getRustCore} from './rust-core.js';

const OUT = 3, MAX_UNITS = 65536;

/** Palette, texture and height numbers of a spine seed; undefined keeps the JS hash. */
export function rustSpineNumbers(seed) {
  const core = getRustCore();
  if (typeof seed !== 'string' || seed.length > MAX_UNITS || typeof core?.spine_style_numbers !== 'function'
    || !core.memory || typeof core.alloc_f64 !== 'function' || typeof core.free_f64 !== 'function') return undefined;
  const length = OUT + Math.ceil(seed.length / 4);
  let pointer = 0;
  try {
    pointer = core.alloc_f64(length); if (!pointer) return undefined;
    const units = new Uint16Array(core.memory.buffer, pointer + OUT * 8, seed.length);
    for (let i = 0; i < seed.length; i += 1) units[i] = seed.charCodeAt(i);
    if (core.spine_style_numbers(pointer + OUT * 8, seed.length, pointer) !== 1) return undefined;
    const out = new Float64Array(core.memory.buffer, pointer, OUT);
    const [palette, texture, height] = out;
    if (!Number.isInteger(palette) || palette < 0 || palette > 11 || !Number.isInteger(texture) || texture < 0 || texture > 3
      || !(height >= 0 && height < 1)) return undefined;
    return { palette, texture, height };
  } catch { return undefined; }
  finally { if (pointer) core.free_f64(pointer, length); }
}
