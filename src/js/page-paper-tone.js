import { samplePaperTone } from './page-paper-tone-sample.js';
// Share only the measured RGB triplet, never another page bitmap. The token
// belongs to one settled raster and is replaced by the reader on any change.
const tones = new WeakMap();
const pending = new WeakMap();
const objectKey = value => value && (typeof value === 'object' || typeof value === 'function');
export const paperToneKey = (source, token) => objectKey(token) ? token : source;


export function readPaperTone(source, token) {
  const key = paperToneKey(source, token);
  if (tones.has(key)) return tones.get(key);
  let tone = null;
  try {
    const canvas = Object.assign(document.createElement('canvas'), { width:12, height:12 });
    const context = canvas.getContext('2d', { willReadFrequently:true });
    context.drawImage(source, 0, 0, 12, 12);
    tone = samplePaperTone(context.getImageData(0, 0, 12, 12).data);
  } catch { /* Unreadable or full-bleed pages retain the original stock. */ }
  tones.set(key, tone);
  return tone;
}

async function measureInWorker(entries, signal) {
  const bitmaps = [];
  let worker;
  try {
    for (const entry of entries) {
      if (signal?.aborted) return false;
      bitmaps.push(await createImageBitmap(entry.source));
    }
    if (signal?.aborted) return false;
    worker = new Worker(new URL('./page-paper-tone-worker.js', import.meta.url), { type:'module' });
    const result = await new Promise(resolve => {
      let settled = false;
      const finish = value => {
        if (settled) return;
        settled = true; signal?.removeEventListener('abort', abort);
        worker.onmessage = worker.onerror = worker.onmessageerror = null;
        resolve(value);
      };
      const abort = () => finish(null);
      worker.onmessage = event => finish(event.data?.tones);
      worker.onerror = worker.onmessageerror = event => { event?.preventDefault?.(); finish(null); };
      signal?.addEventListener('abort', abort, { once:true });
      if (signal?.aborted) { abort(); return; }
      try { worker.postMessage({ bitmaps }, bitmaps); } catch { finish(null); }
    });
    const validTone = tone => tone === null || (Array.isArray(tone) && tone.length === 3
      && tone.every(value => Number.isInteger(value) && value >= 0 && value <= 255));
    if (signal?.aborted || !Array.isArray(result) || result.length !== entries.length || !result.every(validTone)) return false;
    entries.forEach((entry, i) => tones.set(entry.toneKey, result[i] === null ? null : Object.freeze(result[i])));
    return true;
  } catch { return false; }
  finally { worker?.terminate(); bitmaps.forEach(bitmap => bitmap.close()); }
}

// The asynchronous path uses exactly the same 12px sampling and quartile rule.
// If a WebView cannot transfer a bitmap, the model keeps its original sampler.
export async function prepareSnapshotPaperTones(snapshot, { signal } = {}) {
  if (signal?.aborted || typeof Worker !== 'function' || typeof OffscreenCanvas !== 'function'
    || typeof createImageBitmap !== 'function') return false;
  const entries = [snapshot, snapshot?.paper].filter(entry => entry?.source && objectKey(entry.toneKey));
  const existing = entries.map(entry => pending.get(entry.toneKey)).filter(Boolean);
  if (existing.length) await Promise.all(existing);
  if (signal?.aborted) return false;
  const missing = entries.filter(entry => !tones.has(entry.toneKey));
  if (!missing.length) return entries.length > 0;
  const job = measureInWorker(missing, signal);
  missing.forEach(entry => pending.set(entry.toneKey, job));
  try { return await job; }
  finally { missing.forEach(entry => { if (pending.get(entry.toneKey) === job) pending.delete(entry.toneKey); }); }
}
