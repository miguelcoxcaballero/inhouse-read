import { scoreFontMask } from './font-score-core.js';
import { loadRustCore } from './rust-core.js';
import { createRustFontScorer } from './font-score-wasm.js';

let active = null;
let queue = Promise.resolve();
const release = () => { active?.rust?.dispose(); active = null; };
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
      active = { job, gray, near, width, height, rows, rust:null };
      const current = active;
      // A cold/offline module must never delay begin or consume the client's
      // startup budget. Score with the original kernel until compilation ends.
      void loadRustCore().then(core => {
        queue = queue.then(() => {
          if (!core || active !== current || current.rust) return;
          try { current.rust = createRustFontScorer(core, current); }
          catch { /* The original scorer remains available on older WebViews. */ }
        });
      }).catch(() => {});
      self.postMessage({ type:'begin', job, request, accepted:true });
    } else if (type === 'score') {
      if (!active || active.job !== job) throw new Error('Inactive font score job');
      const { gray, near, width, height, rows } = active;
      let score;
      if (active.rust) {
        try { score = active.rust.score(data.mask); }
        catch { active.rust.dispose(); active.rust = null; }
      }
      if (score === undefined) {
        const task = scoreFontMask(gray, near, width, height, rows, data.mask);
        let step = task.next();
        while (!step.done) step = task.next();
        score = step.value;
      }
      self.postMessage({ type:'score', job, request, score });
    } else if (type === 'end' && active?.job === job) release();
  } catch {
    if (active?.job === job) release();
    self.postMessage({ type:'error', job, request });
  }
}
// Activation and score/end messages share one queue; a completed compilation
// may never install the image of a job that has since ended or been replaced.
self.onmessage = ({ data }) => (queue = queue.then(() => handle(data)));
