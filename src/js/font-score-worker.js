import { scoreFontMask } from './font-score-core.js';

let active = null;
self.onmessage = ({ data }) => {
  const { type, job, request } = data || {};
  try {
    if (type === 'begin') {
      const { gray, near, width, height, rows } = data;
      if (!(gray instanceof Uint8Array) || !(near instanceof Float32Array) ||
          !Number.isInteger(width) || !Number.isInteger(height) || !Number.isInteger(rows) ||
          width < 1 || height < 1 || rows < 1 || rows > height ||
          gray.length !== width * height || near.length !== gray.length) throw new Error('Invalid font score image');
      active = { job, gray, near, width, height, rows };
      self.postMessage({ type:'begin', job, request, accepted:true });
    } else if (type === 'score') {
      if (!active || active.job !== job) throw new Error('Inactive font score job');
      const { gray, near, width, height, rows } = active;
      const task = scoreFontMask(gray, near, width, height, rows, data.mask);
      let step = task.next();
      while (!step.done) step = task.next();
      self.postMessage({ type:'score', job, request, score:step.value });
    } else if (type === 'end' && active?.job === job) active = null;
  } catch {
    self.postMessage({ type:'error', job, request });
  }
};
