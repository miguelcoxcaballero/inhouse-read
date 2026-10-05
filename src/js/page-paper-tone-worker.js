import { samplePaperTone } from './page-paper-tone-sample.js';

self.onmessage = ({ data }) => {
  const bitmaps = data?.bitmaps || [];
  let canvas;
  try {
    canvas = new OffscreenCanvas(12, 12);
    const context = canvas.getContext('2d', { willReadFrequently:true });
    const tones = bitmaps.map(bitmap => {
      context.clearRect(0, 0, 12, 12);
      context.drawImage(bitmap, 0, 0, 12, 12);
      return samplePaperTone(context.getImageData(0, 0, 12, 12).data);
    });
    self.postMessage({ tones });
  } catch { self.postMessage({ unavailable:true }); }
  finally {
    bitmaps.forEach(bitmap => bitmap.close());
    if (canvas) canvas.width = canvas.height = 0;
  }
};
