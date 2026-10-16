import {createRustBookMotion} from './book-motion-wasm.js';

/** Monotone Hermite interpolation: continuous velocity, no unwanted overshoot when the
 * book slows down, changes direction or returns to its shelf. The numbers come from the
 * numeric core (rust-core/src/book_motion.rs); the original JavaScript sampler, frozen
 * in tests/unit/helpers/reference-book-motion.js, is what the tests compare it with.
 * Scheduling, poses and interruption stay in the renderer. */
export function createBookMotionSampler(frames) {
  const native = createRustBookMotion(frames);
  if (!native) throw new RangeError('El movimiento del libro necesita entre 2 y 1024 fotogramas y el módulo numérico cargado.');
  return native;
}

export function sampleBookMotion(frames, progress) {
  const sampler = createBookMotionSampler(frames);
  try { return sampler.sample(progress); } finally { sampler.dispose(); }
}
