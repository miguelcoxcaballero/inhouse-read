// A PDF cover keeps its original dimensions and JPEG quality. Reading pixels
// for HTMLCanvasElement.toBlob can wait for queued GPU work on the UI thread;
// a transferred bitmap lets the worker perform that readback and encoding.
export async function encodePdfCover(canvas, { signal } = {}) {
  if (signal?.aborted) return null;
  if (typeof Worker === 'function' && typeof OffscreenCanvas === 'function' &&
      typeof createImageBitmap === 'function') {
    let bitmap, worker;
    try {
      bitmap = await createImageBitmap(canvas);
      if (signal?.aborted) return null;
      worker = new Worker(new URL('./cover-encode-worker.js', import.meta.url), { type:'module' });
      const blob = await new Promise((resolve, reject) => {
        let settled = false;
        const finish = (value, error) => {
          if (settled) return;
          settled = true; signal?.removeEventListener('abort', abort);
          worker.onmessage = worker.onerror = worker.onmessageerror = null;
          error ? reject(error) : resolve(value);
        };
        const abort = () => finish(null);
        worker.onmessage = event => event.data?.blob instanceof Blob
          ? finish(event.data.blob) : finish(null, new Error('Cover encoder unavailable'));
        worker.onerror = worker.onmessageerror = event => {
          event?.preventDefault?.(); finish(null, new Error('Cover encoder unavailable'));
        };
        signal?.addEventListener('abort', abort, { once:true });
        if (signal?.aborted) { abort(); return; }
        try { worker.postMessage({ bitmap }, [bitmap]); }
        catch (error) { finish(null, error); }
      });
      return signal?.aborted ? null : blob;
    } catch {
      // Older WebViews, blocked workers and unsupported bitmap transfers retain
      // the existing encoder. An aborted import must never start a second job.
      if (signal?.aborted) return null;
    } finally {
      worker?.terminate(); bitmap?.close();
    }
  }
  return new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .9));
}
