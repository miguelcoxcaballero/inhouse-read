import { getRustCore } from './rust-core.js';

// CSS layout uses fractional positions even when the retained room has an
// integral framebuffer. Choose the nearest integral CSS origin that also
// falls on a physical pixel. Fractional buffers keep their existing path.
// The search runs in the Rust core (rust-core/src/shelf_pixel.rs); the type check stays
// here because the module boundary would coerce strings.
export function shelfPixelOffset(top, width, height, ratio) {
  if (![top,width,height,ratio].every(Number.isFinite)) return 0;
  const core = getRustCore();
  if (typeof core?.shelf_pixel_offset !== 'function') throw new Error('The shelf origin needs the Rust core');
  return core.shelf_pixel_offset(top, width, height, ratio);
}
