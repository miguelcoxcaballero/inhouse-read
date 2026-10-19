import { loadedRustCore } from './rust-core.js';

// The core owns the ring, alpha threshold, quartiles and full-bleed decision.
// This fixed byte arena is released before returning an owned RGB triplet.
export function samplePaperTone(data, core = loadedRustCore()) {
  if (data?.length !== 576) return null;
  const pointer = core.alloc_f64(72);
  if (!pointer) return null;
  try {
    new Uint8Array(core.memory.buffer, pointer, 576).set(data);
    const rgb = core.page_paper_tone(pointer, 576);
    return rgb < 0 ? null : [rgb >>> 16, (rgb >>> 8) & 255, rgb & 255];
  } finally { core.free_f64(pointer, 72); }
}

