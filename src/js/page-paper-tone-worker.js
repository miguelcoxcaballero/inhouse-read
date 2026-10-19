import { samplePaperTone } from './page-paper-tone-sample.js';
import { requireRustCore } from './rust-core.js';

self.onmessage = async ({ data }) => {
  const bitmaps = data?.bitmaps || [];
  let canvas;
  try {
    // Reuse the main realm's compiled core; never fetch or compile another
    // module for two tiny margin samples. This worker owns its small memory.
    if (!(data?.module instanceof WebAssembly.Module)) throw Error('Missing paper sampler module');
    const core = await requireRustCore({ module:data.module });
    canvas = new OffscreenCanvas(12, 12);
    const context = canvas.getContext('2d', { willReadFrequently:true });
    const tones = bitmaps.map(bitmap => {
      context.clearRect(0, 0, 12, 12);
      context.drawImage(bitmap, 0, 0, 12, 12);
      return samplePaperTone(context.getImageData(0, 0, 12, 12).data, core);
    });
    self.postMessage({ tones });
  } catch { self.postMessage({ unavailable:true }); }
  finally {
    bitmaps.forEach(bitmap => bitmap.close());
    if (canvas) canvas.width = canvas.height = 0;
  }
};
