// OKLab * 100 of one 8-bit colour as the numeric core computes it (rust-core/src/cover_relief.rs), through the
// export it keeps for the tests. The sRGB curve comes from the shelf module, as it does for the core's jobs.
import { getRustCore } from '../../../src/js/rust-core.js';
import { needRustShelf } from '../../../src/js/rust-shelf.js';

const seeded = new WeakSet();
export function installLinearTable(core = getRustCore()) {
  if (seeded.has(core.memory)) return core;
  const pointer = core.alloc_f64(256);
  try {
    new Float64Array(core.memory.buffer, pointer, 256).set(needRustShelf().relief_linear_table());
    if (core.relief_linear_set(pointer) !== 1) throw new Error('The core rejected the linear table');
  } finally { core.free_f64(pointer, 256); }
  seeded.add(core.memory);
  return core;
}

export function coreOklab(r, g, b, core = installLinearTable()) {
  const pointer = core.alloc_f64(3);
  try {
    if (core.relief_oklab(r, g, b, pointer) !== 1) throw new Error('The core rejected the colour');
    return Array.from(new Float64Array(core.memory.buffer, pointer, 3));
  } finally { core.free_f64(pointer, 3); }
}
