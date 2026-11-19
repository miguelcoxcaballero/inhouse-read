// A book's motion on its own, as production samples it: the shelf module's sampler and clock
// (rust-ui/src/book_sampler.rs) and the pose maker of the view's host (src/js/book-view-wasm.js). A view never
// needs this shape (book_view_motion.rs samples in place); the tests that sample keyframes without a view do.
import { rustShelf } from './rust-shelf-ready.js';
import { motionPose } from '../../../src/js/book-view-wasm.js';

export const MOTION_KEYS = Object.freeze(['x','y','scale','angle','pitch','roll','coverOpen','bookmarkWithdraw','pageTheme']);
const host = { pose:motionPose };

/** The sampler of a motion; a RangeError for fewer than 2 or more than 1024 keyframes. */
export function createBookMotionSampler(frames) {
  let id = rustShelf.book_sampler_open(frames);
  return {
    sample:progress => rustShelf.book_sampler_pose(id, progress, host),
    start(milliseconds, now) { rustShelf.book_sampler_start(id, milliseconds, now); },
    step:now => rustShelf.book_sampler_step(id, now),
    dispose() { rustShelf.book_sampler_close(id); id = 0; }
  };
}
/** The same, or null where the bridge it replaced answered null. */
export function createRustBookMotion(frames) {
  try { return createBookMotionSampler(frames); } catch (error) { if (error instanceof RangeError) return null; throw error; }
}
export function sampleBookMotion(frames, progress) {
  const sampler = createBookMotionSampler(frames);
  try { return sampler.sample(progress); } finally { sampler.dispose(); }
}
