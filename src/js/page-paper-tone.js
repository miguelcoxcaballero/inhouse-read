import { samplePaperTone } from './page-paper-tone-sample.js';
import { getRustCoreModule } from './rust-core.js';
import { needRustShelf } from './rust-shelf.js';

// Weak identity caches, queue ownership and result validation belong to Rust.
// The browser bridge owns the actual canvas readback and transferable bitmaps.
let bindings;
function host() {
  const rust=needRustShelf();
  return bindings ||= {
    sample(source) {
      const canvas=Object.assign(document.createElement('canvas'),{width:12,height:12});
      const context=canvas.getContext('2d',{willReadFrequently:true});
      context.drawImage(source,0,0,12,12);
      return samplePaperTone(context.getImageData(0,0,12,12).data);
    },
    measure:measureInWorker, measured:rust.paper_tone_measured,
    afterPending:rust.paper_tone_after_pending, clearPending:rust.paper_tone_clear_pending,
  };
}
export const paperToneKey=(source,token)=>needRustShelf().paper_tone_key(source,token);
export const sharePaperTone=(target,source)=>needRustShelf().paper_tone_share(target,source);
export const readPaperTone=(source,token)=>needRustShelf().paper_tone_read(host(),source,token);
export async function prepareSnapshotPaperTones(snapshot,{signal}={}) {
  return needRustShelf().paper_tone_prepare(host(),snapshot,signal);
}

async function measureInWorker(entries, signal) {
  const module = getRustCoreModule();
  if (!module) return null;
  const bitmaps = [];
  let worker;
  try {
    for (const entry of entries) {
      if (signal?.aborted) return null;
      bitmaps.push(await createImageBitmap(entry.source));
    }
    if (signal?.aborted) return null;
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
      try { worker.postMessage({ bitmaps, module }, bitmaps); } catch { finish(null); }
    });
    return result;
  } catch { return null; }
  finally { worker?.terminate(); bitmaps.forEach(bitmap => bitmap.close()); }
}
