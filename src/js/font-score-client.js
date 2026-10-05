// One lazily-created module Worker; matcherTurn serializes production callers.
// Keep all input arrays in the caller so an unavailable/failed worker can use the original scorer.
const STARTUP_TIMEOUT_MS = 3_000, SCORE_TIMEOUT_MS = 2_000, IDLE_RELEASE_MS = 30_000;
let shared = null, nextJob = 0;
const createWorker = () => new Worker(new URL('./font-score-worker.js', import.meta.url), { type:'module' });

function createClient(factory, events) {
  const worker = factory();
  let pending = null, activeJob = null, idle = 0, sequence = 0, disposed = false;
  const client = {
    get busy() { return activeJob !== null; },
    dispose(error = new Error('Font score worker closed')) {
      if (disposed) return;
      disposed = true; clearTimeout(idle);
      if (shared === client) shared = null;
      if (pending) { clearTimeout(pending.timer); pending.reject(error); pending = null; }
      events?.removeEventListener?.('pagehide', pagehide);
      worker.onmessage = worker.onerror = worker.onmessageerror = null;
      try { worker.terminate(); } catch { /* Closing must never block promise settlement. */ }
    },
    async begin(context, job) {
      if (disposed || activeJob !== null) throw new Error('Font score worker unavailable');
      clearTimeout(idle); activeJob = job;
      await request('begin', job, context);
      let closed = false;
      return {
        score(mask) {
          if (closed || disposed || activeJob !== job) return Promise.reject(new Error('Inactive font score job'));
          return request('score', job, { mask });
        },
        close() {
          if (closed) return;
          closed = true;
          if (disposed || activeJob !== job) return;
          if (pending?.job === job) { client.dispose(new Error('Font score job cancelled')); return; }
          activeJob = null;
          try { worker.postMessage({ type:'end', job }); }
          catch { client.dispose(); return; }
          idle = setTimeout(() => client.dispose(), IDLE_RELEASE_MS);
        }
      };
    }
  };
  function request(type, job, payload) {
    return new Promise((resolve, reject) => {
      if (disposed || pending) { reject(new Error('Font score worker unavailable')); return; }
      const id = ++sequence;
      const timeout = type === 'begin' ? STARTUP_TIMEOUT_MS : SCORE_TIMEOUT_MS;
      const timer = setTimeout(() => client.dispose(new Error('Font score worker did not reply')), timeout);
      pending = { type, job, id, timer, resolve, reject };
      try { worker.postMessage({ ...payload, type, job, request:id }); }
      catch (error) { client.dispose(error); }
    });
  }
  worker.onmessage = ({ data }) => {
    if (!pending || data?.job !== pending.job || data?.request !== pending.id) return;
    const waiting = pending;
    if (data.type !== waiting.type ||
        (waiting.type === 'begin' ? data.accepted !== true : typeof data.score !== 'number' || !Number.isFinite(data.score))) {
      client.dispose(new Error('Invalid font score worker reply')); return;
    }
    pending = null; clearTimeout(waiting.timer);
    waiting.resolve(waiting.type === 'score' ? data.score : true);
  };
  worker.onerror = event => { event.preventDefault?.(); client.dispose(new Error('Font score worker failed')); };
  worker.onmessageerror = () => client.dispose(new Error('Font score worker message failed'));
  const pagehide = () => client.dispose();
  events?.addEventListener?.('pagehide', pagehide);
  return client;
}

export async function openFontScoreJob(context, { factory = createWorker, events = globalThis } = {}) {
  if (factory === createWorker && typeof Worker !== 'function') return null;
  let client;
  try {
    if (shared?.busy) return null;
    client = shared || (shared = createClient(factory, events));
    return await client.begin(context, ++nextJob);
  } catch {
    client?.dispose();
    return null;
  }
}
