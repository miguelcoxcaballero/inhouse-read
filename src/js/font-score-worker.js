import { requireRustCore } from './rust-core.js';
import { createRustFontScorer } from './font-score-wasm.js';

let active = null;
let queue = Promise.resolve();
const release = () => { active?.rust?.dispose(); active = null; };
// One family has at most 24 masks. Score that bounded batch in the same
// order and with the same Rust kernel, without 24 main-thread round trips.
function scoreMask(mask) {
  return active.rust.score(mask);
}
async function handle(data) {
  const { type, job, request } = data || {};
  try {
    if (type === 'begin') {
      release();
      const { gray, near, width, height, rows } = data;
      if (!(gray instanceof Uint8Array) || !(near instanceof Float32Array) ||
          !Number.isInteger(width) || !Number.isInteger(height) || !Number.isInteger(rows) ||
          width < 1 || height < 1 || rows < 1 || rows > height ||
          gray.length !== width * height || near.length !== gray.length) throw new Error('Invalid font score image');
      const rust = createRustFontScorer(await requireRustCore({ module:data.module }), { gray, near, width, height, rows });
      active = { job, rust };
      self.postMessage({ type:'begin', job, request, accepted:true });
    } else if (type === 'score') {
      if (!active || active.job !== job) throw new Error('Inactive font score job');
      self.postMessage({ type:'score', job, request, score:scoreMask(data.mask) });
    } else if (type === 'scores') {
      if (!active || active.job !== job || !Array.isArray(data.masks) || data.masks.length > 24)
        throw new Error('Invalid font score batch');
      self.postMessage({ type:'scores', job, request, scores:data.masks.map(scoreMask) });
    } else if (type === 'end' && active?.job === job) release();
  } catch {
    if (active?.job === job) release();
    self.postMessage({ type:'error', job, request });
  }
}
// Activation and score/end messages share one queue; a completed compilation
// may never install the image of a job that has since ended or been replaced.
self.onmessage = ({ data }) => (queue = queue.then(() => handle(data)));
